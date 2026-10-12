import { useRef, useState } from 'react'
import type { DocumentView } from './env'
import './styles.css'

/** Electron wraps what a handler throws. The reader gets the sentence the handler wrote. */
function reason(caught: unknown, fallback: string): string {
  if (!(caught instanceof Error)) return fallback
  return caught.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
}

export function App() {
  const [contextDir, setContextDir] = useState<string | null>(null)
  const [projects, setProjects] = useState<string[]>([])
  const [view, setView] = useState<DocumentView | null>(null)
  const [anchor, setAnchor] = useState('')
  // Where the passage was selected, so a sentence that occurs twice is commented where it was picked.
  const [from, setFrom] = useState(0)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const page = useRef<HTMLDivElement>(null)

  async function openContext() {
    setError(null)
    const opened = await window.mate.openContext()
    if (!opened) return
    setContextDir(opened.dir)
    setProjects(opened.projects)
    setView(null)
  }

  async function openProject(project: string, file?: string) {
    setError(null)
    try {
      setView(await window.mate.openProject(project, file))
      setAnchor('')
      setText('')
    } catch (caught) {
      // The page must not keep showing another project's draft under this one's name.
      setView(null)
      setError(reason(caught, 'Could not open the project.'))
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
    setFrom(before.toString().length)
    setAnchor(range.toString().trim())
  }

  async function addComment() {
    if (!view?.file) return
    setError(null)
    try {
      setView(await window.mate.addComment(view.project, view.file, anchor, text, 'you', from))
      setAnchor('')
      setText('')
    } catch (caught) {
      setError(reason(caught, 'Could not add the comment.'))
    }
  }

  const drafts = view && view.drafts.length > 1 ? view.drafts : []

  return (
    <div className="app">
      <aside className="rail">
        <h1>Mate</h1>
        <button onClick={openContext}>Open context</button>
        {contextDir && <p className="meta">{contextDir}</p>}
        <ul className="projects">
          {projects.map((project) => (
            <li key={project}>
              <button
                className={view?.project === project ? 'row active' : 'row'}
                onClick={() => openProject(project)}
              >
                {project}
              </button>
              {view?.project === project && drafts.length > 0 && (
                <ul className="drafts">
                  {drafts.map((file) => (
                    <li key={file}>
                      <button
                        className={view.file === file ? 'row active' : 'row'}
                        onClick={() => openProject(project, file)}
                      >
                        {file}
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
        ) : view.file === null ? (
          <p>This project has {drafts.length} drafts. Pick one on the left.</p>
        ) : (
          <>
            <h1>{view.project} / {view.file}</h1>
            <div className="doc" ref={page} onMouseUp={pickPassage}>{view.text}</div>
          </>
        )}
      </main>
      <aside className="notes">
        {error && <p className="error" role="alert">{error}</p>}
        {view && (
          <>
            {view.file !== null && (
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
                  <textarea rows={4} value={text} onChange={(event) => setText(event.target.value)} />
                </label>
                <p><button onClick={addComment}>Add to the file</button></p>
                {view.comments.map((comment) => (
                  <article className="comment" key={comment.id}>
                    <p>{comment.text}</p>
                    <p className="meta">{comment.author} on “{comment.anchor}”</p>
                  </article>
                ))}
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
