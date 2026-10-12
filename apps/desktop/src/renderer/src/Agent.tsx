import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
/**
 * The agent's side of a project. It is there for as long as the project is open, and is drawn
 * into whichever place the window gives it: the margin, or the page for a session that is not
 * about a draft. With no place it draws nothing, and still keeps up with its sessions.
 */
export function Agent({ project, onChanged, into }: { project: string; onChanged: () => void; into: HTMLElement | null }) {
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Where the reader's own agent connects, while a session for it is open.
  const [door, setDoor] = useState<{ url: string; token: string } | null>(null)
  const end = useRef<HTMLDivElement>(null)
  // Whether the reader trusts this context. It decides what an invited Hermes may use.
  const [trusted, setTrusted] = useState(false)

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
    window.mate.isTrusted().then(setTrusted, () => setTrusted(false))
  }, [project])

  useEffect(
    () =>
      window.mate.onSession((next) => {
        if (next.project !== project) return
        keep(next)
      }),
    [project]
  )

  const own = session?.agent === 'mcp' ? session.id : null
  useEffect(() => {
    setDoor(null)
    if (own) window.mate.bindMcp(project, own).then(setDoor, (caught) => setError(reason(caught)))
  }, [project, own])

  const last = session?.messages[session.messages.length - 1]
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [open, session?.messages.length, last?.text, session?.running, into])

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

  if (!into) return null

  if (!session) {
    return createPortal(
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
        <p className="meta hint trust">
          {trusted
            ? 'This context is trusted. Hermes on this computer runs here as it does in your terminal: its own tools, your connections, commands. Mate still rules on what changes in this folder, and does not see the rest. Other agents get tools for files only.'
            : 'This context is not trusted. An agent gets tools for files and nothing else.'}
          <button onClick={() => window.mate.setTrusted(!trusted).then(setTrusted, (caught) => setError(reason(caught)))}>
            {trusted ? 'Stop trusting' : 'Trust this context…'}
          </button>
        </p>
        {sessions.length > 0 && <h3>Earlier sessions</h3>}
        {sessions.map((each) => (
          <button key={each.id} className="row" onClick={() => setOpen(each.id)}>
            {label(each)} · {each.messages.find((message) => message.role === 'you')?.text ?? 'Nothing said yet'}
          </button>
        ))}
      </>,
      into
    )
  }

  // The answer being written does not count: there is no plan to approve until one has been given.
  const answers = session.messages.filter((message) => message.role === 'agent').length - (session.running ? 1 : 0)
  const planned = answers > 0
  const approving = session.queue.some((each) => each.approve)
  // In a trusted context Hermes on this computer stays between turns, and can be told something while it works.
  const listens = trusted && session.agent === 'hermes' && !session.host

  return createPortal(
    <>
      <p className="meta talk-head">
        <button className="quiet" onClick={() => setOpen(null)}>‹ Sessions</button>
        <span>
          {label(session)} · {session.planApproved ? 'may edit this project' : 'plan not approved'}
          {listens && ' · trusted'}
        </span>
      </p>
      {door && (
        <details className="door" open={session.messages.length === 0}>
          <summary>How your agent connects</summary>
          <p>Over MCP, on this computer only. Give your agent this address and header:</p>
          <pre>{door.url}{'\n'}Authorization: Bearer {door.token}</pre>
          <p>In Claude Code, for example:</p>
          <pre>claude mcp add --transport http mate {door.url} --header "Authorization: Bearer {door.token}"</pre>
          <p>It works in this session while it is the one open here. It follows the same rules as an invited agent.</p>
        </details>
      )}
      {session.messages.map((message, index) => (
        <div key={index} className={`said ${message.role}${message.waiting ? ' waiting' : ''}`}>
          {message.tools.length > 0 && (
            <details className="steps">
              <summary>{message.tools.length === 1 ? '1 step' : `${message.tools.length} steps`}</summary>
              {message.tools.map((tool, step) => <p key={step}>{tool}</p>)}
            </details>
          )}
          {message.role === 'agent' ? <div className="prose"><Rendered text={message.text} /></div> : <p>{message.text}</p>}
          {message.waiting && <p className="meta">Waits until the agent has finished this turn.</p>}
        </div>
      ))}
      {session.running && <p className="meta working">Working…</p>}

      {/* The agent waits here for a yes or a no. Yes is for this one thing, once. */}
      {(session.asks ?? []).map((ask) => (
        <div key={ask.id} className="decide" role="alert">
          <p>{label(session)} asks: {ask.title}</p>
          {ask.detail && <pre>{ask.detail}</pre>}
          <p>
            <button className="primary" onClick={() => void window.mate.answerAsk(session.id, ask.id, true)}>Allow once</button>
            <button className="quiet" onClick={() => void window.mate.answerAsk(session.id, ask.id, false)}>Deny</button>
          </p>
        </div>
      ))}

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
          placeholder={
            session.running
              ? listens
                ? 'Add something. The agent takes it into what it is doing.'
                : 'Add something. It goes to the agent when this turn has ended.'
              : !planned
                ? 'Say what you want done'
                : session.planApproved
                  ? 'Say what comes next'
                  : 'Answer, or ask for a change to the plan'
          }
          onChange={(event) => setText(event.target.value)}
        />
        <footer>
          {session.running ? (
            <button className="quiet" onClick={() => window.mate.stopTurn(session.id)}>Stop</button>
          ) : (
            <span />
          )}
          {!session.planApproved && planned && !approving && (
            <button onClick={() => send(true)}>Approve the plan</button>
          )}
          <button className="primary" title="⌘↵" disabled={!text.trim()} onClick={() => send(false)}>
            Send
          </button>
        </footer>
      </div>
      <div ref={end} />
    </>,
    into
  )
}
