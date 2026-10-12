import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Agent } from './Agent'
import type { AssistState, DocumentView, FileView, Hit, Kind } from './env'
import { Rendered, type Passage } from './Rendered'
import { Tree } from './Tree'
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
  project: { label: 'Project file', note: 'A file of its project that is not a draft. It is read here, not reviewed.' },
  context: { label: 'Context', note: 'A file of the whole context. It is read here, not reviewed.' },
  pane: { label: 'Pane', note: 'A pane of its project: what an agent gathered to show beside the draft. It is not a source.' }
}

export function App() {
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
  // The margin shows the threads of the draft, the agent invited into the project, or one of its panes.
  const [tab, setTab] = useState('review')
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
    // An agent may have written the draft or a pane, and the Agent tab may not be open to notice.
    const unhear = window.mate.onSession((session) => {
      if (session.project === project && !session.running) reload()
    })
    return () => {
      current = false
      window.removeEventListener('focus', reload)
      unhear()
    }
  }, [project, file, readingPath])

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

  async function openProject(name: string, draft?: string) {
    setError(null)
    setActive(null)
    setReading(null)
    setFound(null)
    clearComment()
    try {
      setView(await window.mate.openProject(name, draft))
    } catch (caught) {
      // The page must not keep showing another project's draft under this one's name.
      setView(null)
      setError(reason(caught, 'Could not open the project.'))
    }
  }

  /** Put a file on the page to be read, not reviewed. `path` is counted from the context folder. */
  async function read(path: string) {
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
  const shown = pane ? 'pane' : tab === 'agent' ? 'agent' : 'review'
  // Where the page is in the tree of the open project, when it is in it at all.
  const inTree = reading ? (reading.project === project ? reading.path.split('/').slice(2).join('/') : null) : file && `draft/${file}`

  return (
    <div className="app">
      <aside className="rail">
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
              {projects.length === 0 && <p className="meta hint">No projects in this folder.</p>}
              <ul>
                {projects.map((name) => (
                  <li key={name}>
                    <button className={project === name ? 'row active' : 'row'} onClick={() => openProject(name)}>
                      {name}
                    </button>
                    {view && project === name && <Tree paths={view.files} current={inTree} onOpen={openFile} />}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </aside>
      <main className="center">
        <header className="bar">
          {reading && <span className={`kind ${reading.kind}`}>{KINDS[reading.kind].label}</span>}
          {reading && <span>{reading.path}</span>}
          {!reading && view && <span className="meta">{view.project}</span>}
          {!reading && file !== null && <span className="meta">/</span>}
          {!reading && file !== null && <span>{file}</span>}
        </header>
        <div className="scroll">
          {reading ? (
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
        <header className="bar">
          {reading && !view && 'Read only'}
          {view && (
            <span className="tabs">
              <button className={shown === 'review' ? 'quiet active' : 'quiet'} onClick={() => setTab('review')}>Review</button>
              <button className={shown === 'agent' ? 'quiet active' : 'quiet'} onClick={() => setTab('agent')}>Agent</button>
              {/* ponytail: a pane is a tab of the margin, so it hides the review and the agent.
                  Its own column when the columns can be resized. */}
              {view.panes.map((each) => (
                <button
                  key={each.name}
                  className={pane === each ? 'quiet active' : 'quiet'}
                  title={`panes/${each.name}`}
                  onClick={() => setTab(`pane:${each.name}`)}
                >
                  {each.name.replace(/\.md$/i, '')}
                </button>
              ))}
            </span>
          )}
        </header>
        <div className="scroll">
          {error && <p className="error" role="alert">{error}</p>}
          {reading && (!view || shown === 'review') && <p className="meta hint">{KINDS[reading.kind].note}</p>}
          {view && shown === 'agent' && (
            <Agent
              project={view.project}
              onChanged={() => window.mate.openProject(view.project, view.file ?? undefined).then(setView, () => {})}
            />
          )}
          {pane && (
            <>
              <p className="meta asof">
                panes/{pane.name}, written{' '}
                {new Date(pane.written).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}. It does
                not update itself. Ask the agent to write it again.
              </p>
              <div className="prose pane"><Rendered text={pane.text} /></div>
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
    </div>
  )
}
