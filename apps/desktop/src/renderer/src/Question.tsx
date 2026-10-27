import { useEffect } from 'react'
import { Boundary } from './Boundary'
import type { Hit } from './env'
import { Rendered } from './Rendered'

/**
 * A question asked of the whole context, by meaning: the passages closest to it, whole, grouped by
 * the document they are in. No model writes anything here: each passage is the text of its file, and
 * opens there. So it works in a private context as well as in any other.
 */
export function Question(props: {
  question: string
  /** Null while the passages are looked for. */
  found: { missing: string | null; hits: Hit[] } | null
  label: (hit: Hit) => string
  onOpen: (hit: Hit) => void
  onClose: () => void
}) {
  const { question, found, label, onOpen, onClose } = props
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])
  // The documents in the order of their closest passage. In each, the passages in the order they come.
  const documents = new Map<string, Hit[]>()
  for (const hit of found?.hits ?? []) documents.set(hit.path, [...(documents.get(hit.path) ?? []), hit])
  return (
    <>
      <header className="bar">
        <span className="meta">Question</span>
        <span className="acts">
          <button className="quiet" title="Esc" onClick={onClose}>
            Close
          </button>
        </span>
      </header>
      <div className="scroll">
        <div className="page question">
          <h1>{question}</h1>
          {!found ? (
            <p className="meta">Looking for the passages closest in meaning…</p>
          ) : found.missing ? (
            <p className="meta">{found.missing}</p>
          ) : found.hits.length === 0 ? (
            <p className="meta">Nothing in this context is close to it in meaning. Ask in other words, or search for a word in the rail.</p>
          ) : (
            <>
              <p className="meta">
                {found.hits.length === 1 ? 'One passage' : `${found.hits.length} passages`} in{' '}
                {documents.size === 1 ? 'one document' : `${documents.size} documents`}, the closest first. Each is the text of its file.
              </p>
              {[...documents].map(([path, hits]) => (
                <section key={path}>
                  <h2>
                    <span className={`kind ${hits[0].kind}`}>{label(hits[0])}</span> {hits[0].title}
                    {hits[0].project && <span className="meta"> · {hits[0].project}</span>}
                  </h2>
                  <p className="meta">{path}</p>
                  {[...hits]
                    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0))
                    .map((hit) => (
                      <div key={hit.start} className="passage">
                        <div className="prose">
                          <Boundary what="This passage" of={hit.passage}>
                            <Rendered text={hit.passage ?? hit.match} />
                          </Boundary>
                        </div>
                        <button className="quiet" onClick={() => onOpen(hit)}>
                          Open it at this place
                        </button>
                      </div>
                    ))}
                </section>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  )
}
