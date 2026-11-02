import { useEffect, useState } from 'react'
import { changedParts, type DiffLine } from '../../shared/diff'
import type { Pulls } from './env'

const said = (caught: unknown) => String((caught as Error)?.message ?? caught).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

const VERDICTS: Record<string, string> = { APPROVED: 'approved', REQUEST_CHANGES: 'asked for changes', COMMENT: 'commented', REQUEST_REVIEW: 'is asked to review' }

/**
 * The pull requests of a project that is a clone of a repository on the reader's Gitea or GitHub. One is
 * checked out to be reviewed: its files are read and commented on as drafts are, and the review goes to
 * the forge as the reader's. The forge is asked when this opens and when the reader presses, at no other time.
 */
export function PullRequests(props: { project: string; onOpen: (path: string) => void; onChanged: () => Promise<void>; onClose: () => void }) {
  const { project, onOpen, onChanged, onClose } = props
  const [held, setHeld] = useState<Pulls | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  // The file whose change is on show, and its lines.
  const [picked, setPicked] = useState<string | null>(null)
  const [lines, setLines] = useState<DiffLine[] | null>(null)
  // What the reader says of the whole pull request, sent with the review, and of their change to its text.
  const [words, setWords] = useState('')
  const [message, setMessage] = useState('')
  // Whether the on-device model can word the commit, and whether it is at it.
  const [canDraft, setCanDraft] = useState(false)
  const [drafting, setDrafting] = useState(false)
  useEffect(() => void window.mate.checkAssist().then((state) => setCanDraft(state.available), () => setCanDraft(false)), [])

  // Asked again with the list: the reader may have trusted the context in the margin since. Main checks it at every press.
  const [trusted, setTrusted] = useState(true)
  const load = () =>
    Promise.all([window.mate.listPulls(project).then(setHeld, (caught) => setError(said(caught))), window.mate.isTrusted().then(setTrusted, () => setTrusted(false))])
  useEffect(() => {
    void load()
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [project, onClose])

  /** One press: it runs, the project is read again, and the forge is asked again. Null from main: the reader said no. */
  async function act<T>(run: () => Promise<T | null>, after: (result: T) => string) {
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const result = await run()
      if (result === null) return
      setDone(after(result))
      setPicked(null)
      await onChanged()
      await load()
    } catch (caught) {
      setError(said(caught))
    } finally {
      setBusy(false)
    }
  }

  const pick = (where: string) => {
    if (picked === where) return setPicked(null)
    setPicked(where)
    setLines(null)
    window.mate.pullChanges(project, where).then(setLines, (caught) => setError(said(caught)))
  }

  const review = held?.review ?? null
  const comments = (count: number) => (count === 1 ? 'one comment' : `${count} comments`)
  const send = (verdict: 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVED') =>
    act(
      () => window.mate.sendReview(project, verdict, words),
      (count) => (setWords(''), `Sent to ${held?.host}, with ${comments(count)}.`)
    )

  return (
    <>
      <header className="bar">
        <span className="title">
          <strong>Pull requests</strong>
          <span className="meta">{held ? `${held.repo} on ${held.host}` : project}</span>
        </span>
        <span className="acts">
          <button className="quiet" title="Esc" onClick={onClose}>
            Close
          </button>
        </span>
      </header>
      <div className="scroll">
        <div className="page history pulls">
          <h1>{review ? `#${review.number} ${review.title}` : 'Pull requests'}</h1>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {done && <p className="meta" role="status">{done}</p>}
          {!trusted && <p className="meta">Mate checks out a pull request only in a context you trust: git runs what a repository names. Trust this context in the Agent tab.</p>}
          {review && (
            <>
              <p className="meta">
                {review.headRef} into {review.baseRef}. The files of the project are the pull request's now: open one to read it, comment on it, or
                edit it, alone or with an agent.
              </p>
              {held!.verdicts.length > 0 && (
                <ul>
                  {held!.verdicts.map((each, at) => (
                    <li key={at}>
                      <strong>{each.author}</strong> {VERDICTS[each.state] ?? each.state.toLowerCase()}
                      {each.stale && <span className="meta"> on an earlier commit</span>}
                      {each.body && <span className="meta">: {each.body}</span>}
                    </li>
                  ))}
                </ul>
              )}
              <h2>Files</h2>
              <ul>
                {review.files.map((where) => (
                  <li key={where}>
                    <span className="row">
                      <button className="quiet" title="Open it to read and comment" onClick={() => onOpen(where)}>
                        {where}
                      </button>
                      <button className="quiet" title={`What the pull request changed in it, against ${review.baseRef}`} onClick={() => pick(where)}>
                        {picked === where ? 'Hide changes' : 'Changes'}
                      </button>
                    </span>
                    {picked === where &&
                      (lines === null ? (
                        <p className="meta">…</p>
                      ) : (
                        <pre className="diff">
                          {changedParts(lines, 3).map((line, at) => (
                            <span key={at} className={line.kind === '+' ? 'in' : line.kind === '-' ? 'out' : undefined}>
                              {line.kind} {line.text}
                            </span>
                          ))}
                        </pre>
                      ))}
                  </li>
                ))}
              </ul>
              {held!.edited.length > 0 && (
                <>
                  <h2>Your change</h2>
                  <p className="meta">
                    You changed {held!.edited.join(', ')}.{' '}
                    {held!.fork
                      ? 'The branch of this pull request is on a fork, where Mate does not push. Commit it there with git, or put the text back.'
                      : `It goes to ${review.headRef} as one commit of yours, before your review: your comments then go on its lines.`}
                  </p>
                  {!held!.fork && (
                    <form
                      className="acts"
                      onSubmit={(event) => {
                        event.preventDefault()
                        void act(
                          () => window.mate.commitToPull(project, message),
                          (pushed) => (setMessage(''), `Pushed to ${pushed.branch}: ${pushed.files.join(', ')}.`)
                        )
                      }}
                    >
                      <input value={message} placeholder="What you changed" aria-label="What your commit is" onChange={(event) => setMessage(event.target.value)} />
                      {canDraft && (
                        <button
                          type="button"
                          className="quiet"
                          disabled={drafting || busy}
                          title="Let the model on this computer word it from your change. You still read it and press Commit."
                          onClick={() => {
                            setDrafting(true)
                            setError(null)
                            window.mate
                              .draftCommit(project)
                              .then(setMessage, (caught) => setError(said(caught)))
                              .finally(() => setDrafting(false))
                          }}
                        >
                          {drafting ? 'Drafting…' : 'Draft'}
                        </button>
                      )}
                      <button className="primary" disabled={busy || !message.trim()}>
                        Commit and push…
                      </button>
                    </form>
                  )}
                </>
              )}
              <h2>Your review</h2>
              <p className="meta">
                {typeof held!.pending === 'string'
                  ? held!.pending
                  : held!.pending === 0
                    ? `No comment of yours is waiting. The comments in the margin that came from ${held!.forge} are there already.`
                    : `${comments(held!.pending)} of yours ${held!.pending === 1 ? 'goes' : 'go'} with it, each on its line.`}
              </p>
              <textarea className="steer" value={words} rows={3} placeholder="What you say of the whole pull request, if anything" aria-label="Your review" onChange={(event) => setWords(event.target.value)} />
              <p className="acts">
                <button disabled={busy} onClick={() => void send('COMMENT')}>Comment</button>
                <button disabled={busy} onClick={() => void send('REQUEST_CHANGES')}>Request changes</button>
                <button className="primary" disabled={busy} onClick={() => void send('APPROVED')}>Approve</button>
              </p>
              <h2>When it is done</h2>
              <p className="acts">
                <button disabled={busy} title={`${held!.host} merges it, as the repository merges`} onClick={() => void act(() => window.mate.mergePull(project), (merged) => `Merged #${merged.number} into ${merged.base}.${merged.moved ? ` Your ${merged.base} has it too.` : ''}`)}>
                  Merge into {review.baseRef}…
                </button>
                <button className="quiet" disabled={busy} title="Check out what the project was on before. Nothing is sent." onClick={() => void act(() => window.mate.leavePull(project), () => `Back on ${review.back.length === 40 ? 'the commit it was on' : review.back}.`)}>
                  Back to {review.back.length === 40 ? review.back.slice(0, 7) : review.back}
                </button>
              </p>
            </>
          )}
          {held && !review && (
            <ul>
              {held.pulls.map((pull) => (
                <li key={pull.number}>
                  <span className="row">
                    <span>
                      <strong>#{pull.number} {pull.title}</strong>{' '}
                      <span className="meta">
                        {pull.author} · {pull.head} into {pull.base}
                      </span>
                    </span>
                    <button disabled={busy} title="Check it out here, with its comments in the margin" onClick={() => void act(() => window.mate.takePull(project, pull.number), (taken) => `On #${taken.number} now. Its files are in the project.`)}>
                      Review
                    </button>
                  </span>
                </li>
              ))}
              {held.pulls.length === 0 && <li className="meta">No pull request is open.</li>}
            </ul>
          )}
        </div>
      </div>
    </>
  )
}
