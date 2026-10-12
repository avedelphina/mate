import { useState } from 'react'
import type { DocumentView } from './env'
import './styles.css'

export function App() {
  const [contextDir, setContextDir] = useState<string | null>(null)
  const [projects, setProjects] = useState<string[]>([])
  const [document, setDocument] = useState<DocumentView | null>(null)
  const [anchor, setAnchor] = useState('')
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function openContext() {
    setError(null)
    const opened = await window.mate.openContext()
    if (!opened) return
    setContextDir(opened.dir)
    setProjects(opened.projects)
    setDocument(null)
  }

  async function openProject(project: string) {
    setError(null)
    try {
      setDocument(await window.mate.openProject(project))
      setAnchor('')
      setText('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not open the project.')
    }
  }

  async function addComment() {
    if (!document) return
    setError(null)
    try {
      setDocument(await window.mate.addComment(document.project, document.file, anchor, text, 'you'))
      setAnchor('')
      setText('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add the comment.')
    }
  }

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
                className={document?.project === project ? 'row active' : 'row'}
                onClick={() => openProject(project)}
              >
                {project}
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <main className="center">
        {document ? (
          <>
            <h1>{document.project} / {document.file}</h1>
            <div className="doc">{document.markdown}</div>
          </>
        ) : (
          <p>Open a context, then a project. The draft is the page.</p>
        )}
      </main>
      <aside className="notes">
        {document && (
          <>
            <h1>Comment</h1>
            <label>
              Sentence
              <textarea rows={3} value={anchor} onChange={(event) => setAnchor(event.target.value)} />
            </label>
            <label>
              Note
              <textarea rows={4} value={text} onChange={(event) => setText(event.target.value)} />
            </label>
            <p><button onClick={addComment}>Add to the file</button></p>
            {document.comments.map((comment) => (
              <article className="comment" key={comment.id}>
                <p>{comment.text}</p>
                <p className="meta">{comment.author} on “{comment.anchor}”</p>
              </article>
            ))}
            {document.intents && <section><h1>Intents</h1><div className="doc">{document.intents}</div></section>}
            {document.principles && <section><h1>Principles</h1><div className="doc">{document.principles}</div></section>}
          </>
        )}
        {error && <p className="error">{error}</p>}
      </aside>
    </div>
  )
}
