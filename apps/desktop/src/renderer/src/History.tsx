import { useEffect, useState } from 'react'
import { changedParts, type DiffLine } from '../../shared/diff'
import type { Commit } from './env'

/**
 * The history of one file: what changed since the last commit, and each commit that changed it,
 * with what it changed. Only in a context the reader trusts, since git is asked; the diff is Mate's.
 */
export function History(props: { path: string; onClose: () => void }) {
  const { path, onClose } = props
  const [held, setHeld] = useState<{ repository: boolean; commits: Commit[]; changed: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The change on show: `now` for since the last commit, or a commit's hash.
  const [picked, setPicked] = useState<string | null>(null)
  const [lines, setLines] = useState<DiffLine[] | null>(null)
  const said = (caught: unknown) => String((caught as Error)?.message ?? caught).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

  useEffect(() => {
    window.mate.historyOf(path).then(setHeld, (caught) => setError(said(caught)))
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [path, onClose])

  const pick = (which: string) => {
    if (picked === which) return setPicked(null)
    setPicked(which)
    setLines(null)
    window.mate.compareFile(path, which === 'now' ? null : which).then(setLines, (caught) => setError(said(caught)))
  }
  const shown = (which: string) =>
    picked === which &&
    (lines === null ? (
      <p className="meta">…</p>
    ) : lines.every((line) => line.kind === ' ') ? (
      <p className="meta">No line of it changed.</p>
    ) : (
      <pre className="diff">
        {changedParts(lines, 3).map((line, at) => (
          <span key={at} className={line.kind === '+' ? 'in' : line.kind === '-' ? 'out' : undefined}>
            {line.kind} {line.text}
          </span>
        ))}
      </pre>
    ))

  return (
    <>
      <header className="bar">
        <span className="meta">History</span>
        <span>{path}</span>
        <span className="acts">
          <button className="quiet" title="Esc" onClick={onClose}>
            Close
          </button>
        </span>
      </header>
      <div className="scroll">
        <div className="page history">
          <h1>{path.split('/').pop()}</h1>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {held && !held.repository && <p className="meta">This file is in no git repository, so it has no history. Start one from the rail.</p>}
          {held?.repository && (
            <ul>
              {held.changed && (
                <li>
                  <button className="row" onClick={() => pick('now')}>
                    <strong>Since the last commit</strong> <span className="meta">not committed yet</span>
                  </button>
                  {shown('now')}
                </li>
              )}
              {held.commits.map((commit) => (
                <li key={commit.hash}>
                  <button className="row" onClick={() => pick(commit.hash)}>
                    <strong>{commit.subject}</strong>{' '}
                    <span className="meta">
                      {commit.author} · {new Date(commit.date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · {commit.hash.slice(0, 7)}
                    </span>
                  </button>
                  {shown(commit.hash)}
                </li>
              ))}
              {held.commits.length === 0 && !held.changed && <li className="meta">No commit has this file yet.</li>}
            </ul>
          )}
        </div>
      </div>
    </>
  )
}
