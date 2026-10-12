import { useEffect, useRef, useState } from 'react'
import type { AgentInfo, AgentKind, Session } from './env'
import { Rendered } from './Rendered'

function reason(caught: unknown): string {
  if (!(caught instanceof Error)) return 'That did not work.'
  return caught.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
}

/**
 * The agent's side of the margin: invite one into the project, talk to it, approve its plan,
 * and decide about every file it touched. What the agent may write is decided in the main
 * process, by the guard. Nothing here can let a change through on its own.
 */
export function Agent({ project, onChanged }: { project: string; onChanged: () => void }) {
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const end = useRef<HTMLDivElement>(null)
  const changed = useRef(onChanged)
  changed.current = onChanged

  const session = sessions.find((each) => each.id === open) ?? null
  const label = (each: { agent: AgentKind; host: string | null }) =>
    agents.find((agent) => agent.kind === each.agent && agent.host === each.host)?.label ?? each.agent
  const keep = (next: Session) =>
    setSessions((all) => (all.some((each) => each.id === next.id) ? all.map((each) => (each.id === next.id ? next : each)) : [next, ...all]))

  useEffect(() => {
    void window.mate.listAgents().then(setAgents)
  }, [])

  useEffect(() => {
    setOpen(null)
    window.mate.listSessions(project).then(setSessions, () => setSessions([]))
  }, [project])

  useEffect(
    () =>
      window.mate.onSession((next) => {
        if (next.project !== project) return
        keep(next)
        // The agent may have changed the draft that is on the page.
        if (!next.running) changed.current()
      }),
    [project]
  )

  const last = session?.messages[session.messages.length - 1]
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [open, session?.messages.length, last?.text, session?.running])

  async function act(action: () => Promise<Session>, after?: () => void) {
    setError(null)
    try {
      keep(await action())
      after?.()
    } catch (caught) {
      setError(reason(caught))
    }
  }

  const invite = (agent: AgentInfo) =>
    act(async () => {
      const started = await window.mate.startSession(project, agent.kind, agent.host ?? undefined)
      setOpen(started.id)
      return started
    })

  const send = (approve: boolean) => {
    if (!session) return
    void act(() => window.mate.sendMessage(project, session.id, text, approve), () => setText(''))
  }

  if (!session) {
    return (
      <>
        {error && <p className="error" role="alert">{error}</p>}
        <p className="meta hint">
          Invite an agent into {project}. It may read the whole context. It plans first, and it writes only in this project.
        </p>
        <p className="invite">
          {agents.map((agent) => (
            <button
              key={agent.label}
              disabled={!agent.found}
              title={
                agent.host
                  ? 'On another machine. It has no folder there: Mate sends it the text of the files.'
                  : agent.found
                    ? undefined
                    : `${agent.label} was not found on this computer.`
              }
              onClick={() => invite(agent)}
            >
              {agent.label}
            </button>
          ))}
        </p>
        {sessions.length > 0 && <h3>Earlier sessions</h3>}
        {sessions.map((each) => (
          <button key={each.id} className="row" onClick={() => setOpen(each.id)}>
            {label(each)} · {each.messages.find((message) => message.role === 'you')?.text ?? 'Nothing said yet'}
          </button>
        ))}
      </>
    )
  }

  const planned = session.messages.some((message) => message.role === 'agent')

  return (
    <>
      <p className="meta talk-head">
        <button className="quiet" onClick={() => setOpen(null)}>‹ Sessions</button>
        <span>{label(session)} · {session.planApproved ? 'may edit this project' : 'plan not approved'}</span>
      </p>
      {session.messages.map((message, index) => (
        <div key={index} className={`said ${message.role}`}>
          {message.tools.length > 0 && (
            <details className="steps">
              <summary>{message.tools.length === 1 ? '1 step' : `${message.tools.length} steps`}</summary>
              {message.tools.map((tool, step) => <p key={step}>{tool}</p>)}
            </details>
          )}
          {message.role === 'agent' ? <div className="prose"><Rendered text={message.text} /></div> : <p>{message.text}</p>}
        </div>
      ))}
      {session.running && <p className="meta working">Working…</p>}

      {session.held.map(
        (held, index) =>
          held.state === 'waiting' && (
            <div key={index} className="decide">
              <p>The agent wants to change <code>{held.path}</code>. The file is as it was.</p>
              <p>
                <button onClick={() => act(() => window.mate.settleHeld(project, session.id, index, true), onChanged)}>
                  Approve this file
                </button>
                <button className="quiet" onClick={() => act(() => window.mate.settleHeld(project, session.id, index, false))}>
                  Discard
                </button>
              </p>
            </div>
          )
      )}
      {session.changes.map(
        (change, index) =>
          !change.reverted && (
            <p key={index} className="changed">
              <span>Changed <code>{change.path}</code></span>
              <button className="quiet" onClick={() => act(() => window.mate.revertChange(project, session.id, index), onChanged)}>
                Revert
              </button>
            </p>
          )
      )}
      {error && <p className="error" role="alert">{error}</p>}

      <div className="composer talk" onKeyDown={(event) => event.key === 'Enter' && (event.metaKey || event.ctrlKey) && send(false)}>
        <textarea
          aria-label="Message to the agent"
          rows={2}
          value={text}
          placeholder={!planned ? 'Say what you want done' : session.planApproved ? 'Say what comes next' : 'Answer, or ask for a change to the plan'}
          onChange={(event) => setText(event.target.value)}
        />
        <footer>
          {session.running ? (
            <button className="quiet" onClick={() => window.mate.stopTurn(session.id)}>Stop</button>
          ) : (
            <span />
          )}
          {!session.planApproved && planned && !session.running && (
            <button onClick={() => send(true)}>Approve the plan</button>
          )}
          <button className="primary" title="⌘↵" disabled={session.running || !text.trim()} onClick={() => send(false)}>
            Send
          </button>
        </footer>
      </div>
      <div ref={end} />
    </>
  )
}
