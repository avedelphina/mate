import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { EFFORTS } from '../../shared/effort'
import { fileNamed } from '../../shared/named'
import type { AgentInfo, AgentKind, Compared, Models, Session } from './env'
import { Boundary } from './Boundary'
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
export function Agent(props: {
  project: string
  onChanged: () => void
  into: HTMLElement | null
  /** Told which session is open, so that a pane can say something to it. */
  onSession: (id: string | null) => void
  /** The files of the project, and how one is opened: a file an agent names in its answer opens from there. */
  files: string[]
  onOpen: (path: string) => void
  /** The settings page, where the endpoint is set. What it shows is read again when the page closes. */
  onSettings: () => void
  settingsOpen: boolean
}) {
  const { project, onChanged, into, onSession, files, onOpen, onSettings, settingsOpen } = props
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Where the reader's own agent connects, while a session for it is open.
  const [door, setDoor] = useState<{ url: string; token: string } | null>(null)
  const end = useRef<HTMLDivElement>(null)
  // The change the reader is looking at, as lines. One at a time.
  const [compared, setCompared] = useState<({ key: string } & Compared) | null>(null)
  // Whether the reader trusts this context. It decides what an invited Hermes may use.
  const [trusted, setTrusted] = useState(false)
  // Whether the context is private. Then no agent can be invited, and main refuses one all the same.
  const [kept, setKept] = useState(false)
  // In a private context: whether Hermes on the reader's own endpoint may read it, and that endpoint.
  const [opened, setOpened] = useState(false)
  const [endpoint, setEndpoint] = useState<{ url: string; model: string; hasKey: boolean } | null>(null)

  const session = sessions.find((each) => each.id === open) ?? null
  useEffect(() => onSession(session?.id ?? null), [session?.id])
  const label = (each: { agent: AgentKind; host: string | null }) =>
    agents.find((agent) => agent.kind === each.agent && agent.host === each.host)?.label ?? each.agent
  const keep = (next: Session) =>
    setSessions((all) => (all.some((each) => each.id === next.id) ? all.map((each) => (each.id === next.id ? next : each)) : [next, ...all]))

  // Read again when the settings close: the reader adds hosts there.
  useEffect(() => {
    void window.mate.listAgents().then(setAgents)
  }, [settingsOpen])

  useEffect(() => {
    setOpen(null)
    window.mate.listSessions(project).then(setSessions, () => setSessions([]))
  }, [project])

  // What may be changed on the settings page is read again when it closes.
  useEffect(() => {
    window.mate.isTrusted().then(setTrusted, () => setTrusted(false))
    window.mate.isPrivate().then(setKept, () => setKept(false))
    window.mate.isOpened().then(setOpened, () => setOpened(false))
    window.mate.getEndpoint().then(setEndpoint, () => setEndpoint(null))
  }, [project, settingsOpen])


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

  /** Show what a change is, or put it away again. */
  const look = (which: 'kept' | 'held', index: number) => {
    const key = `${open}:${which}:${index}`
    if (compared?.key === key || !open) return setCompared(null)
    window.mate.compare(project, open, which, index).then(
      (found) => setCompared({ key, ...found }),
      (caught) => setCompared({ key, note: reason(caught) })
    )
  }
  const lines = (which: 'kept' | 'held', index: number) =>
    compared?.key === `${open}:${which}:${index}` &&
    (compared.lines ? (
      <pre className="diff">
        {compared.lines.map((line, at) => (
          <span key={at} className={line.kind === '+' ? 'in' : line.kind === '-' ? 'out' : undefined}>
            {line.kind} {line.text}
          </span>
        ))}
      </pre>
    ) : (
      <p className="meta diff-note">{compared.note}</p>
    ))

  const send = (approve: boolean, wait = false) => {
    if (!session) return
    void act(() => window.mate.sendMessage(project, session.id, text, approve, wait), () => setText(''))
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
          {/* In a private context only Hermes on the reader's endpoint is offered, and only once it may read it. */}
          {agents.filter((agent) => (agent.kind === 'private') === kept).map((agent) => (
            <button
              key={agent.label}
              disabled={!agent.found || (kept && !(opened && endpoint)) || (agent.kind === 'kimi' && !trusted)}
              title={
                kept
                  ? opened && endpoint
                    ? `Hermes in ${document.documentElement.dataset.platform === 'mac' ? 'the macOS sandbox' : 'Bubblewrap'}, with your endpoint ${new URL(endpoint.url).host} as its only way out.`
                    : 'This context is private. Allow your endpoint here first.'
                  : agent.kind === 'kimi' && !trusted
                    ? 'Kimi has a shell and the web, and cannot be held to files. It works only in a context you trust.'
                    : agent.host
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
            ? 'This context is trusted. Hermes on this computer runs here as it does in your terminal: its own tools, your connections, commands. Kimi runs here with all its tools too, and asks before each step but a read. Mate still rules on what changes in this folder, and does not see the rest. Other agents get tools for files only.'
            : 'This context is not trusted. An agent gets tools for files and nothing else, and Kimi waits.'}
          <button onClick={() => window.mate.setTrusted(!trusted).then(setTrusted, (caught) => setError(reason(caught)))}>
            {trusted ? 'Stop trusting' : 'Trust this context…'}
          </button>
        </p>
        <p className="meta hint trust private">
          {kept
            ? 'This context is private. No agent works in it, so nothing of it leaves this computer. Search, reading and the comment box still work.'
            : 'An agent sends what it reads to where its model runs.'}
          <button
            onClick={() =>
              window.mate.setPrivate(!kept).then(
                (now) => {
                  setKept(now)
                  window.mate.isOpened().then(setOpened, () => setOpened(false))
                },
                (caught) => setError(reason(caught))
              )
            }
          >
            {kept ? 'Let agents in…' : 'Keep this context private'}
          </button>
        </p>
        {/* The endpoint is set here in any context: it judges questions in any, and works as an agent only in a private one opened to it. */}
        {(
          <div className="meta hint trust endpoint">
            {(
              <>
                {endpoint
                  ? !kept
                    ? `Your endpoint is ${new URL(endpoint.url).host}, with ${endpoint.model}. It can judge a question here.`
                    : opened
                      ? `Hermes on your endpoint, ${new URL(endpoint.url).host}, may read this context. It runs in ${document.documentElement.dataset.platform === 'mac' ? 'the macOS sandbox' : 'Bubblewrap'} and reaches nothing else.`
                      : `Your endpoint is ${new URL(endpoint.url).host}, with ${endpoint.model}. It may not read this context.`
                  : kept
                    ? 'An agent can work here on your own inference endpoint, and nowhere else.'
                    : 'Your own inference endpoint, a server you control, can judge questions, and work in a private context.'}
                {endpoint && kept && (
                  <button onClick={() => window.mate.setOpened(!opened).then(setOpened, (caught) => setError(reason(caught)))}>
                    {opened ? 'Close it to your endpoint' : 'Allow your endpoint here…'}
                  </button>
                )}
                <button className="quiet" onClick={onSettings}>
                  {endpoint ? 'Change the endpoint…' : 'Set your endpoint…'}
                </button>
              </>
            )}
          </div>
        )}
        {sessions.length > 0 && <h3>Sessions <span className="count">{sessions.length}</span></h3>}
        {[...sessions]
          .sort((a, b) => b.created.localeCompare(a.created))
          .map((each) => (
            <button key={each.id} className="row session" onClick={() => setOpen(each.id)}>
              {/* Working, allowed to edit, or still at its plan. */}
              <span className={each.running ? 'dot running' : each.planApproved ? 'dot on' : 'dot'} />
              <span className="title">{each.messages.find((message) => message.role === 'you')?.text ?? 'Nothing said yet'}</span>
              <span className="meta">
                {label(each)} · {new Date(each.created).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                {each.running ? ' · working' : each.planApproved ? '' : ' · plan not approved'}
              </span>
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
          {message.role === 'agent' ? (
            <div className="prose">
              <Boundary what="This answer" of={message.text}>
                <Rendered
                  text={message.text}
                  onName={(words) => {
                    const path = fileNamed(words, project, files)
                    return path === null ? null : () => onOpen(path)
                  }}
                />
              </Boundary>
            </div>
          ) : (
            <p>{message.text}</p>
          )}
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
                <button className="quiet" onClick={() => look('held', index)}>See the change</button>
              </p>
              {lines('held', index)}
            </div>
          )
      )}
      {session.changes.map(
        (change, index) =>
          !change.reverted && (
            <div key={index}>
              <p className="changed">
                <span>Changed <code>{change.path}</code></span>
                <span className="acts">
                  <button className="quiet" onClick={() => look('kept', index)}>Diff</button>
                  <button className="quiet" onClick={() => act(() => window.mate.revertChange(project, session.id, index), onChanged)}>
                    Revert
                  </button>
                </span>
              </p>
              {lines('kept', index)}
            </div>
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
                ? 'Add something. Send puts it into what the agent is doing. After this turn keeps it until then.'
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
          {(session.agent === 'hermes' || session.agent === 'kimi') && !session.host ? (
            <Tune
              agent={session.agent}
              session={session}
              stays={listens}
              onTune={(model, effort) => void act(() => window.mate.tuneSession(project, session.id, model, effort))}
            />
          ) : (
            <span />
          )}
          {session.running && <button className="quiet" onClick={() => window.mate.stopTurn(session.id)}>Stop</button>}
          {!session.planApproved && planned && !approving && (
            <button onClick={() => send(true)}>Approve the plan</button>
          )}
          {/* The last turn was cut off when the app was closed. The agent is asked to take it up again. */}
          {!session.running && session.messages.at(-1)?.cut && (
            <button onClick={() => void act(() => window.mate.sendMessage(project, session.id, 'Go on from where you were cut off.', false))}>
              Go on
            </button>
          )}
          {/* An agent that listens takes a message into the turn it is in. The reader may want it to wait for the turn to end. */}
          {session.running && listens && (
            <button title="It goes to the agent when this turn has ended, and does not change what it is doing now" disabled={!text.trim()} onClick={() => send(false, true)}>
              After this turn
            </button>
          )}
          <button className="primary" title={document.documentElement.dataset.platform === 'mac' ? '⌘↵' : 'Ctrl+Enter'} disabled={!text.trim()} onClick={() => send(false)}>
            Send
          </button>
        </footer>
      </div>
      <div ref={end} />
    </>,
    into
  )
}

/** The end of a model's name, for the line under the message, which has no room for all of it. */
const brief = (name: string) => name.slice(name.lastIndexOf('/') + 1).replace(/^[a-z-]+:/, '')

/**
 * The model Hermes or Kimi thinks with in this conversation, and how hard it thinks. The choice holds
 * from the next turn on. The agent is asked what it offers only when the reader opens this.
 */
function Tune(props: {
  agent: 'hermes' | 'kimi'
  session: Session
  /** The agent stays between turns here. It can be given a model then, and an effort only if it lists some. */
  stays: boolean
  onTune: (model: string | null, effort: string | null) => void
}) {
  const { agent, session, stays, onTune } = props
  const name = agent === 'kimi' ? 'Kimi' : 'Hermes'
  const [models, setModels] = useState<Models | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [find, setFind] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const chosen = session.model ?? null
  const effort = session.effort ?? null
  const named = (id: string) => models?.all.find((each) => each.id === id)?.name ?? id
  const thinks = chosen ?? models?.current
  const seek = useRef<HTMLInputElement>(null)
  // Opened: the whole list again, ready to be searched. The agent is asked for it the first time.
  const opened = () => {
    setFind('')
    seek.current?.focus()
    if (models) return
    setFailed(null)
    window.mate.listModels(agent).then(setModels, (caught) => setFailed(reason(caught)))
  }
  const words = find.toLowerCase().split(/\s+/).filter(Boolean)
  const groups = new Map<string, Models['all']>()
  for (const each of models?.all ?? []) {
    // The agent lists the model it starts with once more under a name of its own. The first row stands for it.
    if (each.id === models?.current) continue
    if (!words.every((word) => `${each.from} ${each.name}`.toLowerCase().includes(word))) continue
    groups.set(each.from, [...(groups.get(each.from) ?? []), each])
  }
  const pick = (model: string | null) => {
    onTune(model, effort)
    box.current?.hidePopover()
  }
  return (
    <>
      <button className="quiet tune" popoverTarget="tune" title={thinks ? named(thinks) : 'The model, and how hard it thinks'}>
        <span>{thinks ? brief(named(thinks)) : 'Model'}</span>
        {effort && (!stays || agent === 'kimi') && ` · ${effort}`}
      </button>
      <div id="tune" popover="auto" ref={box} className="popover picker" onToggle={(event) => event.newState === 'open' && opened()}>
        <input ref={seek} className="search" aria-label="Find a model" placeholder="Find a model" value={find} onChange={(event) => setFind(event.target.value)} />
        <div className="models">
          {!models && !failed && <p className="meta">Asking {name} what it offers…</p>}
          {failed && <p className="error" role="alert">{failed}</p>}
          {models && words.length === 0 && (
            <button className={chosen ? 'row' : 'row active'} onClick={() => pick(null)}>
              {name}’s own{models.current && ` · ${named(models.current)}`}
            </button>
          )}
          {[...groups].map(([from, all]) => (
            <div key={from}>
              {from && <h4>{from}</h4>}
              {all.map((each) => (
                <button key={each.id} className={each.id === chosen ? 'row active' : 'row'} title={each.id} onClick={() => pick(each.id)}>
                  {each.name}
                </button>
              ))}
            </div>
          ))}
          {models && words.length > 0 && groups.size === 0 && <p className="meta">{name} offers no such model.</p>}
        </div>
        <div className="efforts">
          <h4>Thinking</h4>
          {stays && !models?.efforts ? (
            <p className="meta">In a trusted context {name} thinks as hard as its own settings say. It cannot be told otherwise from here yet.</p>
          ) : (
            [null, ...(stays ? models!.efforts! : EFFORTS)].map((each) => (
              <button key={each ?? 'own'} className={each === effort ? 'chip on' : 'chip'} aria-pressed={each === effort} onClick={() => onTune(chosen, each)}>
                {each ?? 'own'}
              </button>
            ))
          )}
        </div>
      </div>
    </>
  )
}
