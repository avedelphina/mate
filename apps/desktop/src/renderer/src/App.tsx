import { createElement, Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { AssistState, DocumentView } from './env'
import { renderMarkdown, type Piece } from './markdown'
import './styles.css'

/** Electron wraps what a handler throws. The reader gets the sentence the handler wrote. */
function reason(caught: unknown, fallback: string): string {
  if (!(caught instanceof Error)) return fallback
  return caught.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
}

/** A stretch of the document that a thread quotes. `id` is null for the passage being commented now. */
type Passage = { id: string | null; start: number; end: number }

/** One stretch of the text, cut wherever a passage starts or ends, so passages that overlap each keep their mark. */
function marked(
  text: string,
  from: number,
  to: number,
  passages: Passage[],
  active: string | null,
  onPick?: (id: string) => void
) {
  const inner = passages.flatMap((passage) => [passage.start, passage.end]).filter((cut) => cut > from && cut < to)
  const cuts = [...new Set([from, ...inner, to])].sort((a, b) => a - b)
  return cuts.slice(0, -1).map((start, index) => {
    const end = cuts[index + 1]
    const piece = text.slice(start, end)
    const over = passages.filter((passage) => passage.start <= start && passage.end >= end)
    if (over.length === 0) return piece
    const ids = over.flatMap((passage) => (passage.id === null ? [] : [passage.id]))
    const classes = [ids.length < over.length && 'pending', active !== null && ids.includes(active) && 'active']
    return (
      <mark
        key={start}
        className={classes.filter(Boolean).join(' ')}
        data-threads={ids.join(' ')}
        onClick={() => ids.length > 0 && onPick?.(ids[0])}
      >
        {piece}
      </mark>
    )
  })
}

/**
 * Markdown, drawn. Its markup is hidden and still in the page, so the text of the page is the
 * text of the file, character for character. pickPassage depends on that.
 */
function Rendered(props: { text: string; passages?: Passage[]; active?: string | null; onPick?: (id: string) => void }) {
  const { text, passages = [], active = null, onPick } = props
  const pieces = useMemo(() => renderMarkdown(text), [text])
  const draw = (piece: Piece, index: number): ReactNode => {
    if ('tag' in piece) {
      const { tag, children, ...rest } = piece
      return createElement(tag, { key: index, ...rest }, children.map(draw))
    }
    if (piece.hidden) return <span key={index} className="syntax">{text.slice(piece.from, piece.to)}</span>
    return <Fragment key={index}>{marked(text, piece.from, piece.to, passages, active, onPick)}</Fragment>
  }
  return <>{pieces.map(draw)}</>
}

// ponytail: a fixed list. Make it a setting when someone wants their own.
const QUICK_NOTES = [
  { label: 'Unclear', text: 'This is unclear. Say it more plainly.' },
  { label: 'Source?', text: 'What is the source for this?' },
  { label: 'Example', text: 'Give an example.' },
  { label: 'Why?', text: 'Why this, and not the alternative?' }
]

const POPOVER_WIDTH = 360

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
  const [error, setError] = useState<string | null>(null)
  const page = useRef<HTMLDivElement>(null)
  const floating = useRef<HTMLDivElement>(null)

  const project = view?.project
  const file = view?.file ?? null

  // The file is the document. It may have been edited or pulled while the window was in the background.
  useEffect(() => {
    if (!project) return
    let current = true
    const reload = () =>
      window.mate.openProject(project, file ?? undefined).then(
        (next) => current && setView(next),
        () => {}
      )
    window.addEventListener('focus', reload)
    return () => {
      current = false
      window.removeEventListener('focus', reload)
    }
  }, [project, file])

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
  }

  async function openProject(name: string, draft?: string) {
    setError(null)
    setActive(null)
    clearComment()
    try {
      setView(await window.mate.openProject(name, draft))
    } catch (caught) {
      // The page must not keep showing another project's draft under this one's name.
      setView(null)
      setError(reason(caught, 'Could not open the project.'))
    }
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

  const drafts = view && view.drafts.length > 1 ? view.drafts : []
  const passages: Passage[] = []
  if (view) {
    for (const thread of view.comments) {
      if (thread.start !== null) passages.push({ id: thread.id, start: thread.start, end: thread.start + thread.anchor.length })
    }
    // The passage being commented stays marked after the selection has moved to the note.
    const picked = anchor ? Math.max(view.text.indexOf(anchor, from), view.text.indexOf(anchor)) : -1
    if (picked >= 0) passages.push({ id: null, start: picked, end: picked + anchor.length })
  }

  const contextName = contextDir?.split(/[\\/]/).filter(Boolean).pop()

  return (
    <div className="app">
      <aside className="rail">
        <header className="bar">Mate</header>
        <div className="scroll">
          <button className="wide" onClick={openContext}>Open context</button>
          {contextDir && (
            <>
              <h2 title={contextDir}>{contextName}</h2>
              {projects.length === 0 && <p className="meta hint">No projects in this folder.</p>}
              <ul>
                {projects.map((name) => (
                  <li key={name}>
                    <button className={project === name ? 'row active' : 'row'} onClick={() => openProject(name)}>
                      {name}
                    </button>
                    {project === name && drafts.length > 0 && (
                      <ul className="drafts">
                        {drafts.map((draft) => (
                          <li key={draft}>
                            <button
                              className={file === draft ? 'row active' : 'row'}
                              onClick={() => openProject(name, draft)}
                            >
                              {draft}
                            </button>
                          </li>
                        ))}
                      </ul>
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
          {view && <span className="meta">{view.project}</span>}
          {file !== null && <span className="meta">/</span>}
          {file !== null && <span>{file}</span>}
        </header>
        <div className="scroll">
          {!view ? (
            <p className="empty">Open a context, then a project. The draft is the page.</p>
          ) : file === null ? (
            <p className="empty">This project has {drafts.length} drafts. Pick one on the left.</p>
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
        <header className="bar">{file !== null && 'Review'}</header>
        <div className="scroll">
          {error && <p className="error" role="alert">{error}</p>}
          {view && file !== null && (
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
          {view?.intents && (
            <details open><summary>Intents</summary><div className="prose"><Rendered text={view.intents} /></div></details>
          )}
          {view?.principles && (
            <details open><summary>Principles</summary><div className="prose"><Rendered text={view.principles} /></div></details>
          )}
        </div>
      </aside>
    </div>
  )
}
