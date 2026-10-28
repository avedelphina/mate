import { useEffect } from 'react'
import { Boundary } from './Boundary'
import type { Hit } from './env'
import { Rendered } from './Rendered'

/** What the reader's endpoint made of the passages: asked for, picked, or not to be had. */
export type Judged = { host: string; asking?: boolean; asked?: number; hits?: Hit[]; error?: string }

/**
 * A question asked of the whole context, by meaning: the passages closest to it, whole, grouped by
 * the document they are in. No model writes anything here: each passage is the text of its file, and
 * opens there. So it works in a private context as well as in any other.
 *
 * Where the reader's endpoint may read the context, it can be asked which of the thirty closest
 * passages answer the question, under the bar for close too. It only picks; the page still shows the
 * files' own text, in its order.
 */
export function Question(props: {
  question: string
  /** Null while the passages are looked for. */
  found: { missing: string | null; hits: Hit[] } | null
  label: (hit: Hit) => string
  /** The host of the reader's endpoint, when it may judge passages here. */
  judgeHost: string | null
  judged: Judged | null
  onJudge: () => void
  onUnjudge: () => void
  onOpen: (hit: Hit) => void
  onClose: () => void
}) {
  const { question, found, label, judgeHost, judged, onJudge, onUnjudge, onOpen, onClose } = props
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])
  const shown = judged?.hits ?? found?.hits ?? []
  // The documents in the order of their first passage. In each, the passages in the order they come.
  const documents = new Map<string, Hit[]>()
  for (const hit of shown) documents.set(hit.path, [...(documents.get(hit.path) ?? []), hit])
  const count = (n: number, one: string, many: string) => (n === 1 ? `one ${one}` : `${n} ${many}`)
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
          ) : (
            <div className="meta summary">
              {judged?.hits ? (
                <p>
                  {judged.host} picked {count(judged.hits.length, 'passage', 'passages')} of the {judged.asked} closest in meaning as answering it, the most
                  relevant first. Each is the text of its file.{' '}
                  <button className="quiet" onClick={onUnjudge}>
                    Show them by meaning again
                  </button>
                </p>
              ) : (
                <p>
                  {found.hits.length === 0
                    ? 'Nothing in this context is close to it in meaning. Ask in other words, or search for a word in the rail.'
                    : `${count(found.hits.length, 'passage', 'passages')} in ${count(documents.size, 'document', 'documents')}, the closest first. Each is the text of its file.`}
                </p>
              )}
              {judgeHost && !judged?.hits && (
                <p>
                  {judged?.asking ? (
                    `Asking ${judgeHost} which of the thirty closest passages answer it…`
                  ) : (
                    <button
                      className="judge"
                      title={`Sends the question and the thirty passages closest in meaning to ${judgeHost}, which picks the ones that answer it. It writes nothing you will read.`}
                      onClick={onJudge}
                    >
                      Ask {judgeHost} which of these answer it
                    </button>
                  )}
                </p>
              )}
              {judged?.error && <p className="error">{judged.error}</p>}
              {judged?.hits?.length === 0 && <p>None of them answers it, by its judgement.</p>}
            </div>
          )}
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
        </div>
      </div>
    </>
  )
}
