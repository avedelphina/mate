import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { DocumentView } from './env'
import './styles.css'

/** Electron wraps what a handler throws. The reader gets the sentence the handler wrote. */
function reason(caught: unknown, fallback: string): string {
  if (!(caught instanceof Error)) return fallback
  return caught.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
}

/** A stretch of the document that a thread quotes. `id` is null for the passage being commented now. */
type Passage = { id: string | null; start: number; end: number }

/** The document text, cut wherever a passage starts or ends, so passages that overlap each keep their mark. */
function marked(text: string, passages: Passage[], active: string | null, onPick: (id: string) => void) {
  const cuts = [...new Set([0, text.length, ...passages.flatMap((passage) => [passage.start, passage.end])])].sort(
    (a, b) => a - b
  )
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
        onClick={() => ids.length > 0 && onPick(ids[0])}
      >
        {piece}
      </mark>
    )
  })
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
  const [active, setActive] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const page = useRef<HTMLDivElement>(null)

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

  function clearComment() {
    setAnchor('')
    setText('')
    setSuggestion(null)
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
    if (!page.current || !selection || selection.isCollapsed) return
    const range = selection.getRangeAt(0)
    if (!page.current.contains(range.commonAncestorContainer)) return
    const before = range.cloneRange()
    before.selectNodeContents(page.current)
    before.setEnd(range.startContainer, range.startOffset)
    const picked = range.toString().trim()
    setFrom(before.toString().length)
    setAnchor(picked)
    setSuggestion((current) => (current === null ? null : picked))
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
    if (anchored) setAnchor('')
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

  return (
    <div className="app">
      <aside className="rail">
        <h1>Mate</h1>
        <button onClick={openContext}>Open context</button>
        {contextDir && <p className="meta">{contextDir}</p>}
        <ul className="projects">
          {projects.map((name) => (
            <li key={name}>
              <button className={project === name ? 'row active' : 'row'} onClick={() => openProject(name)}>
                {name}
              </button>
              {project === name && drafts.length > 0 && (
                <ul className="drafts">
                  {drafts.map((draft) => (
                    <li key={draft}>
                      <button className={file === draft ? 'row active' : 'row'} onClick={() => openProject(name, draft)}>
                        {draft}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </aside>
      <main className="center">
        {!view ? (
          <p>Open a context, then a project. The draft is the page.</p>
        ) : file === null ? (
          <p>This project has {drafts.length} drafts. Pick one on the left.</p>
        ) : (
          <>
            <h1>{view.project} / {file}</h1>
            {/* ponytail: the page is the markdown source, so a selection is exactly the text in the file.
                Rendered markdown needs a map from the rendered text back to the source. */}
            <div className="doc" ref={page} onMouseUp={pickPassage}>
              {marked(view.text, passages, active, setActive)}
            </div>
          </>
        )}
      </main>
      <aside className="notes">
        {error && <p className="error" role="alert">{error}</p>}
        {view && (
          <>
            {file !== null && (
              <>
                <h1>Comment</h1>
                <label>
                  Passage
                  <textarea
                    rows={3}
                    value={anchor}
                    placeholder="Select it in the document"
                    onChange={(event) => setAnchor(event.target.value)}
                  />
                </label>
                <label>
                  Note
                  <textarea rows={3} value={text} onChange={(event) => setText(event.target.value)} />
                </label>
                {suggestion === null ? (
                  <p><button disabled={!anchor} onClick={() => setSuggestion(anchor)}>Suggest a replacement</button></p>
                ) : (
                  <label>
                    Replacement
                    <textarea rows={3} value={suggestion} onChange={(event) => setSuggestion(event.target.value)} />
                  </label>
                )}
                <p><button onClick={addComment}>Add to the file</button></p>
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
                      {unanchored && (
                        <p className="flag">
                          Unanchored. The quoted text is no longer in the file.{' '}
                          <button disabled={!anchor} onClick={() => anchorComment(thread.id)}>Anchor to selection</button>
                        </p>
                      )}
                      {thread.text && <p>{thread.text}</p>}
                      <p className="meta">
                        {thread.author}
                        {thread.resolved && (thread.suggestion === undefined ? ' · resolved' : ' · applied')}
                      </p>
                      {thread.suggestion !== undefined && !thread.resolved && (
                        <p><button disabled={unanchored} onClick={() => applySuggestion(thread.id)}>Apply</button></p>
                      )}
                      {thread.replies.map((reply, replyIndex) => (
                        <div className="reply" key={replyIndex}>
                          <p>{reply.text}</p>
                          <p className="meta">{reply.author}</p>
                        </div>
                      ))}
                      <form onSubmit={(event) => addReply(event, thread.id)}>
                        <input name="reply" placeholder="Reply" aria-label="Reply" />
                        <button>Reply</button>
                      </form>
                    </article>
                  )
                })}
              </>
            )}
            {view.intents && <section><h1>Intents</h1><div className="doc">{view.intents}</div></section>}
            {view.principles && <section><h1>Principles</h1><div className="doc">{view.principles}</div></section>}
          </>
        )}
      </aside>
    </div>
  )
}
