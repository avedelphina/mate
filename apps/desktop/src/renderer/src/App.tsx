import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type FormEvent } from 'react'
import { Agent } from './Agent'
import type { AssistState, DocumentView, FileView, Hit, Kind, Ran } from './env'
import { Rendered, type Passage } from './Rendered'
import { Tree } from './Tree'
import { asked, filled } from '../../shared/run'
import './styles.css'

/** Electron wraps what a handler throws. The reader gets the sentence the handler wrote. */
function reason(caught: unknown, fallback: string): string {
  if (!(caught instanceof Error)) return fallback
  return caught.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
}

// ponytail: a fixed list. Make it a setting when someone wants their own.
const QUICK_NOTES = [
  { label: 'Unclear', text: 'This is unclear. Say it more plainly.' },
  { label: 'Source?', text: 'What is the source for this?' },
  { label: 'Example', text: 'Give an example.' },
  { label: 'Why?', text: 'Why this, and not the alternative?' }
]

const POPOVER_WIDTH = 360

/** What a search hit is called, and what the margin says of a file that is only read. */
const KINDS: Record<Kind, { label: string; note: string }> = {
  shelf: { label: 'Shelf', note: 'The shelf: what is true now. It is read here. It changes only when a project publishes.' },
  draft: { label: 'Proposal', note: '' },
  project: { label: 'Project file', note: 'A file that steers its project. It is read here, not reviewed.' },
  material: { label: 'Material', note: 'A file of its project that is not a draft: what came in for the work, or was made in it. It is read here.' },
  context: { label: 'Context', note: 'A file of the whole context. It is read here, not reviewed.' },
  pane: { label: 'Pane', note: 'A pane of its project: what an agent gathered to show beside the draft. It is not a source.' }
}

/**
 * A file that is not a document on the page: one that comes in from outside the context, or one of
 * the project that Mate cannot draw. `id` stands for a path the reader chose in the system dialog.
 * `inContext` is its path from the context folder, when it is in it.
 */
type Source = { name: string; where: string; id?: string; inContext?: string; markdown: boolean }

// How wide the rail and the margin may be. styles.css keeps the page at 320px or more, whatever these say.
const COLUMNS = {
  rail: { key: 'mate.rail', start: 240, min: 180, max: 480 },
  margin: { key: 'mate.margin', start: 360, min: 280, max: 760 }
}

/**
 * The width of one column, as the reader left it. It is kept on this computer and belongs to the
 * window, not to a context: nothing in a folder says how wide a column is.
 */
function useColumn(which: keyof typeof COLUMNS) {
  const { key, start, min, max } = COLUMNS[which]
  const [width, setWidth] = useState(() => {
    const kept = Number(localStorage.getItem(key))
    return kept >= min && kept <= max ? kept : start
  })
  const set = (next: number) => {
    const fitted = Math.round(Math.min(max, Math.max(min, next)))
    setWidth(fitted)
    localStorage.setItem(key, String(fitted))
  }
  return [width, set] as const
}

/** The edge of a column. Drag it, or move it with the arrow keys. A double click puts the column back. */
function Divider(props: { which: keyof typeof COLUMNS; width: number; set: (width: number) => void }) {
  const { which, width, set } = props
  // The rail grows to the right, the margin to the left.
  const grow = which === 'rail' ? 1 : -1
  return (
    <div
      className="divider"
      role="separator"
      aria-orientation="vertical"
      aria-label={which === 'rail' ? 'Width of the list on the left' : 'Width of the margin on the right'}
      aria-valuenow={width}
      aria-valuemin={COLUMNS[which].min}
      aria-valuemax={COLUMNS[which].max}
      tabIndex={0}
      onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) set(which === 'rail' ? event.clientX : window.innerWidth - event.clientX)
      }}
      onDoubleClick={() => set(COLUMNS[which].start)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') set(width + 16 * grow)
        if (event.key === 'ArrowLeft') set(width - 16 * grow)
      }}
    />
  )
}

export function App() {
  const [rail, setRail] = useColumn('rail')
  const [margin, setMargin] = useColumn('margin')
  const [contextDir, setContextDir] = useState<string | null>(null)
  const [projects, setProjects] = useState<string[]>([])
  const [view, setView] = useState<DocumentView | null>(null)
  const [anchor, setAnchor] = useState('')
  // Where the passage was selected, so a sentence that occurs twice is commented where it was picked.
  const [from, setFrom] = useState(0)
  const [text, setText] = useState('')
  // Null until the reader asks to suggest a replacement. Empty after that means: remove the passage.
  const [suggestion, setSuggestion] = useState<string | null>(null)
  // Where the menu sits, just under the selection, counted inside the scrolling page. Null when closed.
  const [popover, setPopover] = useState<{ left: number; top: number } | null>(null)
  // Null while the menu shows. Then what the reader picked from it, and the form is open.
  const [mode, setMode] = useState<'comment' | 'rewrite' | 'remove' | null>(null)
  const composing = mode !== null
  // The on-device model, on the machines that have one. See docs/architecture.md.
  const [assist, setAssist] = useState<AssistState | null>(null)
  const [drafting, setDrafting] = useState(false)
  // Counts the forms opened so far, so text the model wrote for a form that has closed is dropped.
  const form = useRef(0)
  const [active, setActive] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  // Null while nothing is being searched for, and the rail lists the projects.
  const [hits, setHits] = useState<Hit[] | null>(null)
  // A file that is not a draft, opened from the tree or from a search. It takes the page, and cannot
  // be commented. The project that is open stays open beside it.
  const [reading, setReading] = useState<FileView | null>(null)
  // Where the search matched in the open page.
  const [found, setFound] = useState<{ start: number; end: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Something that went well and is worth a line: a draft was published.
  const [notice, setNotice] = useState<string | null>(null)
  // The documents of the shelf, by their path from the shelf folder.
  const [shelf, setShelf] = useState<string[]>([])
  // The name a draft is being published under, while the reader is choosing it. Null when they are not.
  const [publishing, setPublishing] = useState<string | null>(null)
  // The margin shows the threads of the draft, the agent invited into the project, or one of its panes.
  const [tab, setTab] = useState('review')
  // A session that is not about a draft is a conversation, and the conversation may have the page.
  // Then the margin is free for a pane beside it.
  const [agentOnPage, setAgentOnPage] = useState(false)
  // Where the agent is drawn. Each is there only while its place is on show.
  const [pageSlot, setPageSlot] = useState<HTMLElement | null>(null)
  const [marginSlot, setMarginSlot] = useState<HTMLElement | null>(null)
  // The script that was last run, where its button is, and what it came to. `result` is null while it runs.
  const [ran, setRan] = useState<{ at: string; line: string; result: Ran | null } | null>(null)
  // A run button whose line leaves something open, such as {file}: what the reader is giving for each name.
  const [asking, setAsking] = useState<{ at: string; line: string; given: Record<string, string> } | null>(null)
  // Files the reader is deciding about: each leaves by one of the exits, or is let be.
  const [sources, setSources] = useState<Source[]>([])
  // The session that is open with the agent, when there is one. A pane can say something to it.
  const [sessionOpen, setSessionOpen] = useState<string | null>(null)
  // What a pane last said to the agent, shown on that pane until it is written again.
  const [said, setSaid] = useState<{ pane: string; words: string } | null>(null)
  // The draft as the reader is typing it. Null while the page is read and not written.
  const [typing, setTyping] = useState<string | null>(null)
  // The text the reader began from. A save is refused when the file holds another text by now.
  const based = useRef('')
  // A save that has not come back yet, and whether it went through. Whatever opens next waits for it.
  const saving = useRef<Promise<boolean>>(Promise.resolve(true))
  // The name of a new draft, while the reader is typing it in the rail. Null when they are not.
  const [naming, setNaming] = useState<string | null>(null)
  // The panes of the open project as last seen, to notice one that has just been written.
  const seenPanes = useRef<{ project: string; written: Record<string, number> } | null>(null)
  // Panes written while the reader was in the conversation in the margin. Their tabs are marked, not opened.
  const [fresh, setFresh] = useState<string[]>([])
  const page = useRef<HTMLDivElement>(null)
  const floating = useRef<HTMLDivElement>(null)

  const project = view?.project
  const file = view?.file ?? null
  const readingPath = reading?.path

  // A window opened from another starts in that window's context.
  useEffect(() => {
    void window.mate.currentContext().then((opened) => {
      if (!opened) return
      setContextDir(opened.dir)
      setProjects(opened.projects)
    })
  }, [])

  // With two windows open, the Window menu and the task switcher need to tell them apart.
  useEffect(() => {
    const page = readingPath?.split('/').pop() ?? file
    document.title = page ? `${page} · ${project ?? 'Mate'}` : (project ?? 'Mate')
  }, [project, file, readingPath])

  // The file is the document. It may have been edited or pulled while the window was in the background.
  useEffect(() => {
    if (!project && !readingPath) return
    let current = true
    const reload = () => {
      if (project) window.mate.openProject(project, file ?? undefined).then((next) => current && setView(next), () => {})
      if (readingPath) window.mate.readFile(readingPath).then((next) => current && setReading(next), () => {})
    }
    window.addEventListener('focus', reload)
    // An agent may have written the draft or a pane. Show what the files hold now.
    const unhear = window.mate.onSession((session) => {
      if (session.project === project && !session.running) reload()
    })
    return () => {
      current = false
      window.removeEventListener('focus', reload)
      unhear()
    }
  }, [project, file, readingPath])

  // The shelf is listed with the context, and again when the window is come back to.
  useEffect(() => {
    if (!contextDir) return setShelf([])
    const list = () => window.mate.listShelf().then(setShelf, () => setShelf([]))
    void list()
    window.addEventListener('focus', list)
    return () => window.removeEventListener('focus', list)
  }, [contextDir])

  useEffect(() => {
    if (!contextDir || !query.trim()) return setHits(null)
    let current = true
    const timer = setTimeout(() => {
      window.mate.searchContext(query).then(
        (next) => current && setHits(next),
        () => current && setHits([])
      )
    }, 150)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [contextDir, query])

  // A pane that has just been written is put on show: the agent made it for the reader to see.
  useEffect(() => {
    if (!view) return
    const written = Object.fromEntries(view.panes.map((each) => [each.name, each.written]))
    const before = seenPanes.current?.project === view.project ? seenPanes.current.written : null
    seenPanes.current = { project: view.project, written }
    // The project has just been opened: nothing in it is news.
    if (!before) return setFresh([])
    const news = view.panes.filter((each) => before[each.name] !== each.written).map((each) => each.name)
    if (news.length === 0) return
    setSaid((now) => (now && news.includes(now.pane) ? null : now))
    // Not when that would take the conversation away from the reader. Then the tab is marked instead.
    if (tab === 'agent' && !agentOnPage) setFresh((marked) => [...new Set([...marked, ...news])])
    else setTab(`pane:${news[news.length - 1]}`)
  }, [view])

  useEffect(() => {
    if (found) document.querySelector('mark.found')?.scrollIntoView({ block: 'center' })
  }, [found, view, reading])

  // The passage and its thread are shown together, whichever one was clicked.
  useEffect(() => {
    if (active === null) return
    for (const element of document.querySelectorAll(`[data-threads~="${CSS.escape(active)}"]`)) {
      element.scrollIntoView({ block: 'nearest' })
    }
  }, [active])

  // The menu opens under the selection, which may be at the bottom edge of the window.
  useEffect(() => {
    if (popover) floating.current?.scrollIntoView({ block: 'nearest' })
  }, [popover, composing])

  useEffect(() => {
    if (!popover) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && clearComment()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [popover])

  function clearComment() {
    setAnchor('')
    setText('')
    setSuggestion(null)
    setPopover(null)
    setMode(null)
    form.current += 1
  }

  function compose(next: 'comment' | 'rewrite' | 'remove') {
    setSuggestion(next === 'comment' ? null : next === 'rewrite' ? anchor : '')
    setMode(next)
    // Asked each time: the model may have become ready since the window opened.
    window.mate.checkAssist().then(setAssist, () => setAssist(null))
  }

  /** Let the on-device model write the replacement or the note. The reader still has to add it. */
  async function draft() {
    const asked = form.current
    setError(null)
    setDrafting(true)
    try {
      const written = await window.mate.runAssist(mode === 'rewrite' ? 'rewrite' : 'note', anchor, text)
      if (form.current !== asked) return
      if (mode === 'rewrite') setSuggestion(written)
      else setText(written)
    } catch (caught) {
      setError(reason(caught, 'The assist could not write that.'))
    } finally {
      setDrafting(false)
    }
  }

  async function openContext() {
    setError(null)
    const opened = await window.mate.openContext()
    if (!opened) return
    setContextDir(opened.dir)
    setProjects(opened.projects)
    setView(null)
    setReading(null)
    setQuery('')
  }

  /** What was typed is saved before the page shows something else. A save that failed keeps the page, once. */
  async function leaveEditor(): Promise<boolean> {
    const saved = await saving.current
    saving.current = Promise.resolve(true)
    if (saved) setTyping(null)
    return saved
  }

  /** Begin to type in the draft on the page. */
  function edit() {
    if (!view || file === null) return
    clearComment()
    based.current = view.text
    setTyping(view.text)
  }

  /** Write what was typed into the file. Nothing is written when nothing was typed. */
  function save(): Promise<boolean> {
    if (typing === null || !project || file === null || typing === based.current) return saving.current
    const [inProject, inFile, text] = [project, file, typing]
    saving.current = window.mate.writeDraft(inProject, inFile, based.current, text).then(
      (next) => {
        based.current = next.text
        setError(null)
        setView((now) => (now?.project === inProject && now.file === inFile ? next : now))
        // The file may end with a line break the reader did not type. What they typed since is not touched.
        setTyping((now) => (now === text ? next.text : now))
        return true
      },
      (caught) => {
        setError(reason(caught, 'Could not save the draft.'))
        return false
      }
    )
    return saving.current
  }

  /** Publish the draft on the page under the name the reader chose. Main asks them once more, by name. */
  async function publishDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!project || file === null || !publishing?.trim() || !(await save())) return
    try {
      const done = await window.mate.publishDraft(project, file, publishing)
      if (!done) return
      setError(null)
      setPublishing(null)
      setNotice(`Published as ${done.path}.${done.replaced ? ' The document that was there is kept as history.' : ''}`)
      setShelf(await window.mate.listShelf())
    } catch (caught) {
      setError(reason(caught, 'Could not publish the draft.'))
    }
  }

  /**
   * Make the document on the page a draft of the open project. One of the shelf is copied, and the shelf
   * keeps its own. One of a dropbox is moved: it leaves the dropbox.
   */
  async function takeDown() {
    if (!view || !reading) return
    try {
      const taken = await (reading.kind === 'shelf' ? window.mate.takeDown : window.mate.pullIn)(view.project, reading.path)
      setError(null)
      setReading(null)
      setView(taken)
    } catch (caught) {
      setError(reason(caught, 'Could not take that document down.'))
    }
  }

  async function newDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!project || !naming?.trim() || !(await leaveEditor())) return
    try {
      const made = await window.mate.createDraft(project, naming)
      setError(null)
      setNaming(null)
      setReading(null)
      setAgentOnPage(false)
      setView(made)
      // A new draft is there to be written.
      based.current = made.text
      setTyping(made.text)
    } catch (caught) {
      setError(reason(caught, 'Could not start the draft.'))
    }
  }

  async function openProject(name: string, draft?: string) {
    if (!(await leaveEditor())) return
    setError(null)
    setNotice(null)
    setPublishing(null)
    setActive(null)
    setReading(null)
    setFound(null)
    clearComment()
    try {
      const next = await window.mate.openProject(name, draft)
      setView(next)
      // A project with no draft has nothing to review, so its page goes to the conversation.
      setAgentOnPage(next.drafts.length === 0)
    } catch (caught) {
      // The page must not keep showing another project's draft under this one's name.
      setView(null)
      setError(reason(caught, 'Could not open the project.'))
    }
  }

  /** Put a file on the page to be read, not reviewed. `path` is counted from the context folder. */
  async function read(path: string) {
    if (!(await leaveEditor())) return
    setAgentOnPage(false)
    setNotice(null)
    setPublishing(null)
    setError(null)
    setActive(null)
    setFound(null)
    clearComment()
    try {
      setReading(await window.mate.readFile(path))
    } catch (caught) {
      setReading(null)
      setError(reason(caught, 'Could not open that file.'))
    }
  }

  /** A file picked in the tree of the open project. A draft opens for review. Anything else is read. */
  function openFile(path: string) {
    if (!view) return
    const [folder, name, ...deeper] = path.split('/')
    if (folder === 'draft' && deeper.length === 0 && view.drafts.includes(name)) void openProject(view.project, name)
    else void read(`projects/${view.project}/${path}`)
  }

  /** A draft opens as a draft, at the match. Anything else is opened to be read. */
  async function openHit(hit: Hit) {
    if (hit.kind === 'draft' && hit.project) {
      await openProject(hit.project, hit.path.split('/').pop())
      setActive(hit.thread)
    } else {
      await read(hit.path)
    }
    setFound(hit.start === null ? null : { start: hit.start, end: hit.start + hit.length })
  }

  /** Run one change to the file, then show what the file holds. */
  async function change(action: () => Promise<DocumentView>, fallback: string): Promise<boolean> {
    setError(null)
    try {
      setView(await action())
      return true
    } catch (caught) {
      setError(reason(caught, fallback))
      return false
    }
  }

  function pickPassage() {
    const selection = window.getSelection()
    const scroll = page.current?.parentElement
    if (!page.current || !scroll || !selection) return
    setFound(null)
    if (selection.isCollapsed) {
      // A plain click puts the menu away. It does not throw away a note that is being written.
      if (!composing) clearComment()
      return
    }
    const range = selection.getRangeAt(0)
    if (!page.current.contains(range.commonAncestorContainer)) return
    const picked = range.toString().trim()
    if (!picked) return
    const before = range.cloneRange()
    before.selectNodeContents(page.current)
    before.setEnd(range.startContainer, range.startOffset)
    setFrom(before.toString().length)
    setAnchor(picked)
    setSuggestion((current) => (current ? picked : current))

    const rects = range.getClientRects()
    const last = rects[rects.length - 1] ?? range.getBoundingClientRect()
    const box = scroll.getBoundingClientRect()
    const left = last.left - box.left + scroll.scrollLeft
    setPopover({
      left: Math.max(8, Math.min(left, scroll.clientWidth - POPOVER_WIDTH - 8)),
      top: last.bottom - box.top + scroll.scrollTop + 8
    })
  }

  async function addComment() {
    if (!project || !file) return
    const added = await change(
      () => window.mate.addComment(project, file, anchor, text, 'you', from, suggestion ?? undefined),
      'Could not add the comment.'
    )
    if (added) clearComment()
  }

  async function addReply(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault()
    if (!project || !file) return
    const form = event.currentTarget
    const reply = String(new FormData(form).get('reply') ?? '')
    if (await change(() => window.mate.addReply(project, file, id, reply, 'you'), 'Could not add the reply.')) {
      form.reset()
    }
  }

  async function applySuggestion(id: string) {
    if (!project || !file) return
    await change(() => window.mate.applySuggestion(project, file, id), 'Could not apply the suggestion.')
  }

  async function anchorComment(id: string) {
    if (!project || !file) return
    const anchored = await change(
      () => window.mate.anchorComment(project, file, id, anchor, from),
      'Could not anchor the comment.'
    )
    if (anchored) clearComment()
  }

  const passages: Passage[] = []
  // The threads belong to the draft. A file that is only read has none.
  if (view && !reading) {
    for (const thread of view.comments) {
      if (thread.start !== null) passages.push({ id: thread.id, start: thread.start, end: thread.start + thread.anchor.length })
    }
    // The passage being commented stays marked after the selection has moved to the note.
    const picked = anchor ? Math.max(view.text.indexOf(anchor, from), view.text.indexOf(anchor)) : -1
    if (picked >= 0) passages.push({ id: null, tone: 'pending', start: picked, end: picked + anchor.length })
  }
  if (found) passages.push({ id: null, tone: 'found', ...found })

  const contextName = contextDir?.split(/[\\/]/).filter(Boolean).pop()
  // A tab whose pane file is gone falls back to the review.
  const pane = view?.panes.find((each) => `pane:${each.name}` === tab) ?? null
  const shown = pane ? 'pane' : tab === 'agent' && !agentOnPage ? 'agent' : 'review'
  const onPage = agentOnPage && view !== null

  /** Tick a task in a pane, or clear it. The file changes, so the agent finds it ticked when it next reads. */
  function tick(name: string, base: string, at: number) {
    if (!view) return
    setError(null)
    window.mate.tickPane(view.project, name, base, at, view.file ?? undefined).then(setView, (caught) => {
      setError(reason(caught, 'Could not tick that.'))
      // The pane may have been written meanwhile. Show what the file holds now.
      window.mate.openProject(view.project, view.file ?? undefined).then(setView, () => {})
    })
  }

  /** A pane says its own words to the agent, in the session that is open. The words are the ones on the button. */
  function say(name: string, heard: string) {
    const words = heard.replace(/\s+/g, ' ').trim()
    if (!words) return
    // ponytail: a fixed limit, so that a button is something the reader has read before they press it.
    if (words.length > 300) return setError('That is too long to say from a button. Say it to the agent yourself.')
    void tell(words).then((told) => told && setSaid({ pane: name, words }))
  }

  /** Say something to the agent in the session that is open. False when there is none, or it could not be said. */
  async function tell(words: string): Promise<boolean> {
    if (!view) return false
    if (!sessionOpen) {
      if (!agentOnPage) setTab('agent')
      setError('Open a session with an agent first. Then this can be said to it.')
      return false
    }
    setError(null)
    try {
      await window.mate.sendMessage(view.project, sessionOpen, words, false)
      return true
    } catch (caught) {
      setError(reason(caught, 'Could not say that to the agent.'))
      return false
    }
  }

  /** Run a script of the project, as the line on its button says. No agent is asked. `at` is where the button is. */
  function run(at: string, heard: string, given?: Record<string, string>) {
    let line = heard.replace(/\s+/g, ' ').trim()
    if (!view || !line || ran?.result === null) return
    // Something is left open on the line: the reader is asked for it first, and the script runs when they have said.
    if (asked(line).length > 0) {
      if (!given) return setAsking({ at, line, given: {} })
      try {
        line = filled(line, given)
      } catch (caught) {
        return setError(reason(caught, 'That cannot be given to the script.'))
      }
    }
    setAsking(null)
    const { project: inProject, file: inFile } = view
    setError(null)
    setRan({ at, line, result: null })
    window.mate.runScript(inProject, line).then(
      (result) => {
        setRan({ at, line, result })
        // The script may have written files. Show what the folder holds now.
        window.mate.openProject(inProject, inFile ?? undefined).then((next) => setView((now) => (now?.project === inProject ? next : now)), () => {})
      },
      (caught) => {
        setRan(null)
        setError(reason(caught, 'Could not run that script.'))
      }
    )
  }

  /** What the script at this place is doing, or came to, with what it printed. */
  const outcome = (at: string) =>
    asking?.at === at ? (
      <form
        className="ran given"
        onSubmit={(event) => {
          event.preventDefault()
          run(at, asking.line, asking.given)
        }}
      >
        <p className="meta"><span>{asking.line}</span></p>
        {asked(asking.line).map((name, index) => (
          <label key={name}>
            <span>{name}</span>
            <input
              autoFocus={index === 0}
              list="project-files"
              value={asking.given[name] ?? ''}
              onChange={(event) => setAsking({ ...asking, given: { ...asking.given, [name]: event.target.value } })}
              onKeyDown={(event) => event.key === 'Escape' && setAsking(null)}
            />
          </label>
        ))}
        {/* What is asked for is most often a file of the project, so those are offered. Anything may be typed. */}
        <datalist id="project-files">{view?.files.map((each) => <option key={each} value={each} />)}</datalist>
        <p>
          <span />
          <span>
            <button type="button" className="quiet" onClick={() => setAsking(null)}>Cancel</button>
            <button className="primary">Run</button>
          </span>
        </p>
      </form>
    ) : (
      ran?.at === at && (
      <div className="ran">
        <p className="meta">
          <span>
            {ran.result === null
              ? `Running ${ran.line}…`
              : `${ran.line}: ${ran.result.stopped ? 'stopped' : ran.result.code === 0 ? 'done' : `failed${ran.result.code === null ? '' : ` (${ran.result.code})`}`}, ${ran.result.seconds} s`}
          </span>
          {ran.result === null ? (
            <button className="quiet" onClick={() => void window.mate.stopScript()}>Stop</button>
          ) : (
            <button className="quiet" onClick={() => setRan(null)}>Close</button>
          )}
        </p>
        {ran.result?.output && <pre>{ran.result.output}</pre>}
      </div>
      )
    )

  const settled = (source: Source) => setSources((all) => all.filter((each) => each !== source))

  /** The reader chooses files in the dialog of the system. Each then leaves by one of the exits. */
  async function addSources() {
    try {
      const picked = await window.mate.pickSources()
      if (picked.length > 0) setSources(picked)
    } catch (caught) {
      setError(reason(caught, 'Could not take those files.'))
    }
  }

  /** A file dropped on the window comes in the same way. The window learns where it lies, and cannot read it. */
  function dropped(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    const files = [...event.dataTransfer.files].map((each) => ({ name: each.name, where: window.mate.pathOf(each), markdown: /\.md$/i.test(each.name) }))
    if (files.length === 0) return
    if (!view) return setError('Open a project first. A file that comes in belongs to a project.')
    setSources(files.filter((each) => each.where))
  }

  /** The first exit: the file stays where it is, and a note in the dropbox says where. */
  async function noteSource(source: Source) {
    if (!view) return
    try {
      const note = await window.mate.noteSource(view.project, source.id ?? source.where)
      settled(source)
      setView(await window.mate.openProject(view.project, view.file ?? undefined))
      await read(note)
    } catch (caught) {
      setError(reason(caught, 'Could not note that file.'))
    }
  }

  /**
   * The second exit: a document is copied into the drafts. Only one the reader chose in the dialog of
   * the system is copied. So for a file that was dropped on the window the dialog opens at it, and the
   * reader chooses it there.
   */
  async function pullSource(source: Source) {
    if (!view || !(await leaveEditor())) return
    try {
      const id = source.id ?? (await window.mate.pickSources(source.where)).find((each) => each.markdown)?.id
      if (!id) return
      const pulled = await window.mate.pullSource(view.project, id)
      settled(source)
      setError(null)
      setReading(null)
      setAgentOnPage(false)
      setView(pulled)
    } catch (caught) {
      setError(reason(caught, 'Could not pull that file in.'))
    }
  }

  /** The third exit: the agent takes the text out of the file and writes it as a draft. Mate reads no such file itself. */
  async function extract(source: Source) {
    if (!view) return
    const from = source.inContext ? source.inContext.replace(`projects/${view.project}/`, '') : `the file at ${source.where}`
    const into = `draft/${source.name.replace(/\.[^.]+$/, '')}.md`
    if (await tell(`Extract the text of ${from} into ${into}. Keep its wording and do not summarise it. Say what you could not read.`)) settled(source)
  }

  /** Give the page to the conversation. The margin then shows a pane, when the project has one. */
  function toPage() {
    clearComment()
    setAgentOnPage(true)
    if (tab === 'agent') setTab(view?.panes[0] ? `pane:${view.panes[0].name}` : 'review')
  }

  function toMargin() {
    setAgentOnPage(false)
    setTab('agent')
  }
  // Where the page is in the tree of the open project, when it is in it at all.
  const inTree = reading ? (reading.project === project ? reading.path.split('/').slice(2).join('/') : null) : file && `draft/${file}`

  return (
    <div
      className="app"
      style={{ '--rail-w': `${rail}px`, '--margin-w': `${margin}px` } as CSSProperties}
      onDragOver={(event) => event.dataTransfer.types.includes('Files') && event.preventDefault()}
      onDrop={dropped}
    >
      <aside className="rail">
        <Divider which="rail" width={rail} set={setRail} />
        <header className="bar">Mate</header>
        <div className="scroll">
          <button className="wide" onClick={openContext}>Open context</button>
          {contextDir && (
            <input
              className="search"
              type="search"
              value={query}
              placeholder="Search this context"
              aria-label="Search this context"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === 'Escape' && setQuery('')}
            />
          )}
          {contextDir && hits && (
            <>
              <h2>{hits.length === 0 ? 'No matches' : hits.length === 1 ? '1 match' : `${hits.length} matches`}</h2>
              <ul>
                {hits.map((hit, index) => (
                  <li key={index}>
                    <button className="row hit" onClick={() => openHit(hit)}>
                      <span className={`kind ${hit.kind}`}>{hit.thread ? 'Comment' : KINDS[hit.kind].label}</span>
                      <span className="where">{hit.title}{hit.project && ` · ${hit.project}`}</span>
                      <span className="snippet">{hit.before}<b>{hit.match}</b>{hit.after}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {contextDir && !hits && (
            <>
              <h2 title={contextDir}>{contextName}</h2>
              {/* What is true now, for every project. A document is read from here, and taken down from the page. */}
              {shelf.length > 0 && (
                <details className="shelf">
                  <summary>Shelf</summary>
                  <Tree
                    paths={shelf}
                    current={reading?.kind === 'shelf' ? reading.path.slice('shelf/'.length) : null}
                    onOpen={(path) => void read(`shelf/${path}`)}
                    onReveal={() => {}}
                  />
                </details>
              )}
              {projects.length === 0 && <p className="meta hint">No projects in this folder.</p>}
              <ul className="projects">
                {projects.map((name) => (
                  <li key={name}>
                    <button className={project === name ? 'row active' : 'row'} onClick={() => openProject(name)}>
                      {name}
                    </button>
                    {view && project === name && (
                      <Tree
                        paths={view.files}
                        current={inTree}
                        onOpen={openFile}
                        onReveal={(path) =>
                          setSources([{ name: path.split('/').pop()!, where: path, inContext: `projects/${view.project}/${path}`, markdown: false }])
                        }
                      />
                    )}
                    {view && project === name && (
                      <div className="tree-new">
                        {naming === null ? (
                          <>
                            <button className="row" onClick={() => setNaming('')}>+ New draft</button>
                            <button className="row" title="A file from outside this context. You choose what becomes of it." onClick={() => void addSources()}>
                              + Add a source
                            </button>
                          </>
                        ) : (
                          <form onSubmit={newDraft}>
                            <input
                              autoFocus
                              value={naming}
                              placeholder="Name of the draft"
                              aria-label="Name of the new draft"
                              onChange={(event) => setNaming(event.target.value)}
                              onKeyDown={(event) => event.key === 'Escape' && setNaming(null)}
                              onBlur={() => naming.trim() === '' && setNaming(null)}
                            />
                          </form>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </aside>
      <main className="center">
        <header className="bar">
          {onPage && <span className="meta">{view.project}</span>}
          {onPage && <span className="meta">/</span>}
          {onPage && <span>Agent</span>}
          {onPage && <button className="quiet move" onClick={toMargin}>Back to the margin</button>}
          {!onPage && reading && <span className={`kind ${reading.kind}`}>{KINDS[reading.kind].label}</span>}
          {!onPage && reading && <span>{reading.path}</span>}
          {!onPage && reading?.kind === 'shelf' && view && (
            <span className="acts">
              <button className="quiet" title="A copy the project owns. The shelf keeps its own." onClick={() => void takeDown()}>
                Take a copy into {view.project}
              </button>
            </span>
          )}
          {/* Not for a note about a file that was left outside: the note is the exit that file took. */}
          {!onPage &&
            reading &&
            view &&
            !reading.path.endsWith('.source.md') &&
            (reading.path.startsWith('dropbox/') || reading.path.startsWith(`projects/${view.project}/dropbox/`)) && (
            <span className="acts">
              <button className="quiet" title="It leaves the dropbox and becomes a draft of this project." onClick={() => void takeDown()}>
                Pull into draft/
              </button>
            </span>
          )}
          {!onPage && !reading && view && <span className="meta">{view.project}</span>}
          {!onPage && !reading && file !== null && <span className="meta">/</span>}
          {!onPage && !reading && file !== null && <span>{file}</span>}
          {!onPage && !reading && file !== null && (
            <span className="acts">
              {publishing !== null ? (
                <form className="publish" onSubmit={publishDraft}>
                  <input
                    autoFocus
                    list="shelf-names"
                    value={publishing}
                    aria-label="Name on the shelf"
                    title="The name of the document on the shelf. One that is there is replaced, and kept as history."
                    onChange={(event) => setPublishing(event.target.value)}
                    onKeyDown={(event) => event.key === 'Escape' && setPublishing(null)}
                  />
                  <datalist id="shelf-names">{shelf.map((each) => <option key={each} value={each} />)}</datalist>
                  <button className="primary">Publish</button>
                  <button type="button" className="quiet" onClick={() => setPublishing(null)}>Cancel</button>
                </form>
              ) : typing === null ? (
                <>
                  <button className="quiet" onClick={edit}>Edit</button>
                  <button className="quiet" title="Make this draft a document of the shelf" onClick={() => setPublishing(file)}>Publish…</button>
                </>
              ) : (
                <>
                  <button className="quiet" title="⌘S" disabled={typing === based.current} onClick={() => void save()}>Save</button>
                  <button className="quiet" onClick={() => void save().then((saved) => saved && setTyping(null))}>Done</button>
                </>
              )}
            </span>
          )}
        </header>
        <div className="scroll">
          {/* A file the reader is deciding about. It leaves by one of the exits. There is no exit where it is just remembered. */}
          {view &&
            sources.map((source) => (
              <div key={source.where} className="source">
                <p><strong>{source.name}</strong></p>
                <p className="meta">{source.inContext ? `In this project: ${source.where}` : `Not in this context: ${source.where}`}</p>
                <p className="acts">
                  {source.inContext ? (
                    <button
                      onClick={() =>
                        window.mate.revealFile(source.inContext!).catch((caught) => setError(reason(caught, 'Could not show that file.')))
                      }
                    >
                      Show it in {document.documentElement.dataset.platform === 'mac' ? 'Finder' : 'the file manager'}
                    </button>
                  ) : (
                    <button title="The file stays where it is. A note in the dropbox says where." onClick={() => void noteSource(source)}>
                      Leave it there, and note its path
                    </button>
                  )}
                  {source.markdown && !source.inContext && (
                    <button
                      title={source.id ? 'A copy in draft/, to work on.' : 'A copy in draft/, to work on. You choose the file once more, in the dialog of the system.'}
                      onClick={() => void pullSource(source)}
                    >
                      {source.id ? 'Pull it into draft/' : 'Pull it into draft/…'}
                    </button>
                  )}
                  {!source.markdown && !source.where.startsWith('scripts/') && (
                    <button title="Said to the agent in the open session. Mate reads no such file itself." onClick={() => void extract(source)}>
                      Ask the agent to extract its text into draft/
                    </button>
                  )}
                  {source.inContext && source.where.startsWith('scripts/') && (
                    <button title="Run this script here, given nothing. No agent is asked." onClick={() => run(`card:${source.where}`, source.where)}>
                      Run it
                    </button>
                  )}
                  <button className="quiet" onClick={() => settled(source)}>Close</button>
                </p>
                {outcome(`card:${source.where}`)}
              </div>
            ))}
          {onPage ? (
            <div className="page talk-page" ref={setPageSlot} />
          ) : reading ? (
            <div className="page prose">
              <Rendered text={reading.text} passages={passages} />
            </div>
          ) : !view ? (
            <p className="empty">Open a context, then a project. The draft is the page.</p>
          ) : file === null ? (
            <p className="empty">
              {view.drafts.length === 0
                ? 'This project has no draft. Its other files are on the left.'
                : `This project has ${view.drafts.length} drafts. Pick one on the left.`}
            </p>
          ) : typing !== null ? (
            // The text of the file, to type in. What is saved is this text, with the comments kept where they are.
            <textarea
              className="page editor"
              aria-label={`The text of ${file}`}
              value={typing}
              spellCheck
              autoFocus
              onChange={(event) => setTyping(event.target.value)}
              onBlur={() => void save()}
              onKeyDown={(event) => {
                if (event.key !== 's' || !(event.metaKey || event.ctrlKey)) return
                event.preventDefault()
                void save()
              }}
            />
          ) : (
            <div className="page prose" ref={page} onMouseUp={pickPassage}>
              <Rendered text={view.text} passages={passages} active={active} onPick={setActive} />
            </div>
          )}
          {/* Beside the page, not in it: the page holds the text of the file and nothing else. */}
          {popover && !composing && (
            <div className="popover menu" ref={floating} style={popover} role="toolbar" aria-label="Selected passage">
              <button className="quiet" onClick={() => compose('comment')}>Comment</button>
              <button className="quiet" onClick={() => compose('rewrite')}>Rewrite</button>
              <button className="quiet" onClick={() => compose('remove')}>Remove</button>
            </div>
          )}
          {popover && composing && (
            <div
              className="popover composer"
              ref={floating}
              style={{ ...popover, width: POPOVER_WIDTH }}
              role="dialog"
              aria-label="Comment on the selected passage"
              onKeyDown={(event) => event.key === 'Enter' && (event.metaKey || event.ctrlKey) && void addComment()}
            >
              {suggestion !== null && (
                <textarea
                  className="replacement"
                  aria-label="Replacement"
                  rows={1}
                  autoFocus
                  value={suggestion}
                  placeholder="Nothing: the passage is removed"
                  onChange={(event) => setSuggestion(event.target.value)}
                />
              )}
              <textarea
                aria-label="Note"
                rows={2}
                autoFocus={suggestion === null}
                value={text}
                placeholder={suggestion === null ? 'Add a note' : 'Say why (optional)'}
                onChange={(event) => setText(event.target.value)}
              />
              <div className="chips">
                {QUICK_NOTES.map((quick) => (
                  <button key={quick.label} onClick={() => setText(quick.text)}>{quick.label}</button>
                ))}
              </div>
              <footer>
                <button className="quiet" onClick={clearComment}>Cancel</button>
                {assist?.present && (
                  <button
                    className="quiet"
                    disabled={!assist.available || drafting}
                    title={assist.available ? 'Written by the model on this computer. Nothing leaves it.' : assist.reason}
                    onClick={draft}
                  >
                    {drafting ? 'Writing…' : mode === 'rewrite' ? 'Draft the rewrite' : 'Draft the note'}
                  </button>
                )}
                <button className="primary" title="⌘↵" onClick={addComment}>Add to the file</button>
              </footer>
            </div>
          )}
        </div>
      </main>
      <aside className="margin">
        <Divider which="margin" width={margin} set={setMargin} />
        <header className="bar">
          {reading && !view && 'Read only'}
          {view && (
            <span className="tabs">
              <button className={shown === 'review' ? 'quiet active' : 'quiet'} onClick={() => setTab('review')}>Review</button>
              {!agentOnPage && (
                <button className={shown === 'agent' ? 'quiet active' : 'quiet'} onClick={() => setTab('agent')}>Agent</button>
              )}
              {/* ponytail: a pane is a tab of the margin, so it hides the review and the agent.
                  Give it a column of its own when that gets in the way. */}
              {view.panes.map((each) => (
                <button
                  key={each.name}
                  className={pane === each ? 'quiet active' : fresh.includes(each.name) ? 'quiet fresh' : 'quiet'}
                  title={`panes/${each.name}`}
                  onClick={() => {
                    setTab(`pane:${each.name}`)
                    setFresh((marked) => marked.filter((name) => name !== each.name))
                  }}
                >
                  {each.name.replace(/\.md$/i, '')}
                </button>
              ))}
            </span>
          )}
        </header>
        <div className="scroll">
          {error && <p className="error" role="alert">{error}</p>}
          {notice && <p className="notice" role="status">{notice}</p>}
          {reading && (!view || shown === 'review') && <p className="meta hint">{KINDS[reading.kind].note}</p>}
          {view && shown === 'agent' && (
            <>
              <p className="meta talk-move"><button className="quiet" onClick={toPage}>Open in the page</button></p>
              <div ref={setMarginSlot} />
            </>
          )}
          {pane && (
            <>
              <p className="meta asof">
                panes/{pane.name}, written{' '}
                {new Date(pane.written).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}. It does
                not update itself. Ask the agent to write it again.
              </p>
              {said?.pane === pane.name && <p className="meta asof">Said to the agent: “{said.words}”</p>}
              {/* The reader can act on a pane in two ways, and Mate draws both: tick a task, press a line that says its own words. */}
              <div className="prose pane">
                <Rendered
                  text={pane.text}
                  onTick={(at) => tick(pane.name, pane.text, at)}
                  onSay={(words) => say(pane.name, words)}
                  onRun={(line) => run(`pane:${pane.name}`, line)}
                />
              </div>
              {outcome(`pane:${pane.name}`)}
            </>
          )}
          {view && shown === 'review' && file !== null && !reading && (
            <>
              {view.comments.length === 0 && (
                <p className="meta hint">Select a passage in the document to comment on it.</p>
              )}
              {view.comments.map((thread, index) => {
                const unanchored = !thread.resolved && thread.start === null
                const classes = ['thread', active === thread.id && 'active', unanchored && 'unanchored', thread.resolved && 'resolved']
                return (
                  <article
                    key={`${index}:${thread.id}`}
                    className={classes.filter(Boolean).join(' ')}
                    data-threads={thread.id}
                    onClick={() => setActive(thread.id)}
                  >
                    {thread.suggestion === undefined ? (
                      <blockquote>{thread.anchor}</blockquote>
                    ) : (
                      <p className="swap">
                        <del>{thread.anchor}</del>{' '}
                        {thread.suggestion ? <ins>{thread.suggestion}</ins> : <span className="meta">(remove)</span>}
                      </p>
                    )}
                    {thread.text && <p className="note">{thread.text}</p>}
                    <p className="meta">
                      {thread.author}
                      {unanchored && <span className="pill warn">Unanchored</span>}
                      {thread.resolved && (
                        <span className="pill">{thread.suggestion === undefined ? 'Resolved' : 'Applied'}</span>
                      )}
                    </p>
                    {unanchored && (
                      <p className="flag">
                        The quoted text is no longer in the file.{' '}
                        <button disabled={!anchor} onClick={() => anchorComment(thread.id)}>Anchor to selection</button>
                      </p>
                    )}
                    {thread.suggestion !== undefined && !thread.resolved && (
                      <p><button className="primary" disabled={unanchored} onClick={() => applySuggestion(thread.id)}>Apply</button></p>
                    )}
                    {thread.replies.map((reply, replyIndex) => (
                      <div className="reply" key={replyIndex}>
                        <p className="note">{reply.text}</p>
                        <p className="meta">{reply.author}</p>
                      </div>
                    ))}
                    <form onSubmit={(event) => addReply(event, thread.id)}>
                      <input name="reply" placeholder="Reply" aria-label="Reply" />
                      <button className="quiet">Reply</button>
                    </form>
                  </article>
                )
              })}
            </>
          )}
          {shown === 'review' && view?.intents && (
            <details open><summary>Intents</summary><div className="prose"><Rendered text={view.intents} /></div></details>
          )}
          {shown === 'review' && view?.principles && (
            <details open><summary>Principles</summary><div className="prose"><Rendered text={view.principles} /></div></details>
          )}
        </div>
      </aside>
      {/* One agent for the open project, drawn into the margin or the page. It is not started again when it moves. */}
      {view && (
        <Agent
          project={view.project}
          onChanged={() => window.mate.openProject(view.project, view.file ?? undefined).then(setView, () => {})}
          into={onPage ? pageSlot : shown === 'agent' ? marginSlot : null}
          onSession={setSessionOpen}
        />
      )}
    </div>
  )
}
