import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'
import { AGENTS, SSH, agentEnvironment, isHost, sshArgs, type AgentKind } from './agents'
import { resolveInside } from './context'
import { placeOf } from './contextIndex'
import { changesSince, mateWrote, put, takeSnapshot, watching, type Change, type Snapshot } from './guard'

/** `waiting`: sent while the agent was working, and not yet given to it. */
export type Message = { role: 'you' | 'agent' | 'mate'; text: string; tools: string[]; waiting?: boolean }

/** A file the agent changed and Mate let through. `backup` names the bytes from before. Null: there was no file. */
export type Kept = { path: string; backup: string | null; reverted: boolean }

/** A change Mate put back and holds. `file` names the agent's bytes. Null: the agent deleted the file. */
export type Held = { path: string; file: string | null; state: 'waiting' | 'approved' | 'discarded' }

/** A conversation with one agent, inside one project. It is a file in the context, so it outlives the window. */
/** `mcp` is an agent the reader runs themselves. Mate starts nothing: the agent comes in through src/main/mcp.ts. */
export type Invited = AgentKind | 'mcp'

export type Session = {
  id: string
  project: string
  agent: Invited
  /** Set when the agent is on another machine, reached over SSH. It has no folder there. */
  host: string | null
  /** What each file looked like when it was last sent to an agent on another machine. */
  sent: Record<string, string>
  created: string
  /** The agent's own id for the conversation. With it the agent picks up where it stopped. */
  agentSession: string | null
  planApproved: boolean
  messages: Message[]
  /** What the reader sent while the agent was working. It goes to the agent when the turn has ended. */
  queue: { text: string; approve: boolean }[]
  changes: Kept[]
  held: Held[]
  running: boolean
}

const RULES = `You have been invited into a project on a Mate desk. Mate is a tool for reviewing documents.
Your working folder is one project. The project is part of a context: a folder of related work.

Where things are, from your working folder:
- draft/ holds the documents under review in this project. They are proposals, not the reference.
- intents.md and principles.md steer this project. Follow them.
- ../../shelf/ is the shelf: the current reference for the whole context. What is true now is there.
- ../ holds the other projects of the context. Their drafts are proposals too.

Rules:
1. You may read the whole context. When you rely on a file, say whether it is the shelf or a proposal.
2. Write only inside this project. If a file outside it would have to change, do not edit it. Say which
   file and why. Mate puts back any edit made outside this project until the reviewer approves that one file.
3. Propose a plan first, then stop. Edit files only after the reviewer has approved the plan.
4. A line of the form <!-- @comment{...} --> in a draft is a review comment. Leave such lines exactly as
   they are, unless you are asked to answer one.
5. Do not invent evidence that the sources do not contain.`

/** For an agent on another machine. The context folder stays here, and the agent keeps no copy of it. */
const REMOTE_RULES = `You have been invited into a project on a Mate desk. Mate is a tool for reviewing documents.
The project is part of a context: a folder of related work. That folder is on the reviewer's computer,
not on yours. You cannot open files. Mate sends you the text of the files, and sends a file again when it changes.

Each file comes with what it is:
- "shelf" is the current reference for the whole context. What is true now is there.
- "proposal" is a draft under review in a project. It is not the reference.
- "project file" steers a project: its intents and its principles. Follow those of your project.

Rules:
1. When you rely on a file, say whether it is the shelf or a proposal.
2. You may change files of your own project only. If another file would have to change, say which and why.
3. Propose a plan first, then stop. Change files only after the reviewer has approved the plan.
4. To change a file, give its whole new text like this, with the path exactly as Mate gave it:
   <mate-file path="projects/NAME/draft/FILE.md">
   the whole new text of the file
   </mate-file>
   Mate writes it if the rules allow it, and holds it for the reviewer if they do not.
5. A line of the form <!-- @comment{...} --> in a draft is a review comment. Keep such lines exactly as
   they are, unless you are asked to answer one.
6. Do not invent evidence that the sources do not contain.`

const KINDS = { shelf: 'shelf', draft: 'proposal', project: 'project file', context: 'context file' }
const FILE = /<mate-file path="([^"\n]+)">\n?([\s\S]*?)\n?<\/mate-file>/g
// ponytail: every markdown file is sent whole, up to this much in one message. A context is documents.
// Past this, send what the agent asks for.
const MAX_SENT = 300_000

const hash = (bytes: Buffer) => createHash('sha1').update(bytes).digest('hex')

/** The files an agent on another machine has not seen in their present state, as text to send. */
function pack(snapshot: Snapshot, sent: Record<string, string>): string {
  const parts: string[] = []
  let size = 0
  for (const [relative, bytes] of snapshot) {
    if (!relative.toLowerCase().endsWith('.md') || relative.startsWith('.') || sent[relative] === hash(bytes)) continue
    if (size + bytes.length > MAX_SENT) {
      parts.push(`<file path="${relative}" not-sent="too much to send at once" />`)
      continue
    }
    size += bytes.length
    sent[relative] = hash(bytes)
    const place = placeOf(relative)
    const kind = KINDS[place.kind] + (place.project ? ` of project ${place.project}` : '')
    parts.push(`<file path="${relative}" kind="${kind}">\n${bytes.toString('utf8').replace(/\r?\n$/, '')}\n</file>`)
  }
  return parts.join('\n\n')
}

/** The files an agent on another machine asks to change, read out of what it said. */
async function proposed(contextDir: string, text: string): Promise<{ changes: Change[]; refused: string[] }> {
  const changes: Change[] = []
  const refused: string[] = []
  for (const [, named, body] of text.matchAll(FILE)) {
    const relative = named.trim().replace(/^\.\//, '')
    const parts = relative.split('/')
    if (path.isAbsolute(relative) || parts.some((part) => part === '' || part.startsWith('.'))) {
      refused.push(named)
      continue
    }
    const before = await readFile(path.join(contextDir, ...parts)).catch(() => null)
    // The file keeps the line endings it had.
    const windows = before?.includes('\r\n') ?? false
    const after = Buffer.from(windows ? body.replace(/\r?\n/g, '\r\n') + '\r\n' : body + '\n')
    if (!before?.equals(after)) changes.push({ path: relative, before, after })
  }
  return { changes, refused }
}

const folder = (contextDir: string, project: string, id = '') =>
  resolveInside(path.join(contextDir, '.sessions'), project, id)

export async function saveSession(contextDir: string, session: Session): Promise<void> {
  const dir = folder(contextDir, session.project, session.id)
  await mkdir(dir, { recursive: true })
  // Transcripts and the copies kept for Revert stay out of whatever repository the context is in.
  const ignore = path.join(contextDir, '.sessions', '.gitignore')
  if (!existsSync(ignore)) await writeFile(ignore, '*\n')
  const temporary = path.join(dir, `.session.${randomUUID()}.tmp`)
  await writeFile(temporary, JSON.stringify({ ...session, running: false }, null, 2))
  await rename(temporary, path.join(dir, 'session.json'))
}

export async function loadSession(contextDir: string, project: string, id: string): Promise<Session> {
  // While the agent is working the session in memory is the one that counts. A second copy read
  // from the file would be written over when the turn ends.
  const live = turns.get(id)?.session
  if (live) return live
  const session = JSON.parse(await readFile(path.join(folder(contextDir, project, id), 'session.json'), 'utf8')) as Session
  // A session written before agents could be on another machine has neither field.
  return { ...session, host: session.host ?? null, sent: session.sent ?? {}, queue: session.queue ?? [], running: false }
}

/** The sessions of a project, the newest first. */
export async function listSessions(contextDir: string, project: string): Promise<Session[]> {
  const ids = await readdir(folder(contextDir, project)).catch(() => [])
  const sessions = await Promise.all(ids.map((id) => loadSession(contextDir, project, id).catch(() => null)))
  return sessions.filter((session) => session !== null).sort((a, b) => b.created.localeCompare(a.created))
}

export async function startSession(
  contextDir: string,
  project: string,
  agent: Invited,
  host: string | null = null
): Promise<Session> {
  if (agent !== 'mcp' && !AGENTS[agent]) throw new Error('That agent is not one Mate knows.')
  if (host !== null && (agent === 'mcp' || !isHost(host) || !AGENTS[agent].remoteArgs)) {
    throw new Error('That agent cannot be invited from another machine.')
  }
  const session: Session = {
    id: randomUUID(),
    project,
    agent,
    host,
    sent: {},
    created: new Date().toISOString(),
    agentSession: null,
    planApproved: false,
    messages: [],
    queue: [],
    changes: [],
    held: [],
    running: false
  }
  await saveSession(contextDir, session)
  return session
}

const running = new Map<string, ChildProcess>()
async function firstWords(contextDir: string, project: string, remote: boolean): Promise<string> {
  if (remote) return `${REMOTE_RULES}\n\nYour project is "${project}". Its files are under projects/${project}/.`
  const read = (name: string) => readFile(resolveInside(contextDir, 'projects', project, name), 'utf8').catch(() => '')
  const names = (dir: string) => readdir(path.join(contextDir, dir)).then((all) => all.filter((name) => !name.startsWith('.')), () => [])
  const [intents, principles, shelf, projects] = await Promise.all([
    read('intents.md'),
    read('principles.md'),
    names('shelf'),
    names('projects')
  ])
  // Named here so that no agent has to guess what is on the shelf.
  const others = projects.filter((name) => name !== project)
  return [
    RULES,
    `The project is "${project}".`,
    `On the shelf (../../shelf/): ${shelf.join(', ') || 'nothing yet'}.`,
    others.length > 0 && `The other projects (../): ${others.join(', ')}.`,
    intents && `Its intents.md:\n\n${intents}`,
    principles && `Its principles.md:\n\n${principles}`
  ]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * One change, by the rule. Inside the open project, once the plan is approved, it is the agent's work:
 * the bytes from before are kept, so Revert can put them back. Anything else is held for the reader,
 * and the file is as it was.
 *
 * `done` says the change is already in the folder, because an agent on this machine made it.
 */
export async function judge(contextDir: string, session: Session, change: Change, done: boolean): Promise<'kept' | 'held'> {
  const dir = folder(contextDir, session.project, session.id)
  if (session.planApproved && change.path.startsWith(`projects/${session.project}/`)) {
    const backup = change.before ? `${session.changes.length}` : null
    if (change.before) {
      await mkdir(path.join(dir, 'backups'), { recursive: true })
      await writeFile(path.join(dir, 'backups', backup!), change.before)
    }
    if (!done) {
      await put(contextDir, change.path, change.after)
      mateWrote(contextDir, change.path, change.after)
    }
    session.changes.push({ path: change.path, backup, reverted: false })
    return 'kept'
  }
  const file = change.after ? `${session.held.length}` : null
  if (change.after) {
    await mkdir(path.join(dir, 'held'), { recursive: true })
    await writeFile(path.join(dir, 'held', file!), change.after)
  }
  if (done) await put(contextDir, change.path, change.before)
  session.held.push({ path: change.path, file, state: 'waiting' })
  return 'held'
}

/** The turns in progress, by session: the session as it is in memory, and when the turn will have ended. */
const turns = new Map<string, { session: Session; finished: Promise<Session> }>()
/** The contexts in which an agent is working, or is about to. */
const busy = new Set<string>()
/** The last message of each session to come in. The next one waits until that one has been taken in. */
const entering = new Map<string, Promise<void>>()

const conversation = (session: Session) =>
  session.messages
    .filter((each) => each.role !== 'mate' && !each.waiting)
    .map((each) => `${each.role === 'you' ? 'Reviewer' : 'You'}: ${each.text}`)
    .join('\n\n')

/**
 * Send one message and let the agent answer. An approval is a message too.
 *
 * A message sent while the agent is working does not stop the turn. It waits behind it, and goes
 * to the agent as soon as the turn has ended.
 *
 * `started` is the session as the message is taken in. `finished` settles when the agent has
 * stopped, the guard has been through the folder, and nothing is waiting any more.
 */
export async function sendMessage(
  contextDir: string,
  project: string,
  id: string,
  text: string,
  approve: boolean,
  emit: (session: Session) => void
): Promise<{ started: Session; finished: Promise<Session> }> {
  // Two messages sent at the same moment are taken in one after the other, so the second finds the first one's turn.
  const before = entering.get(id) ?? Promise.resolve()
  let taken!: () => void
  entering.set(id, new Promise((resolve) => (taken = resolve)))
  await before
  try {
    const session = await loadSession(contextDir, project, id)
    const said = text.trim()
    if (!said && !approve) throw new Error('The message is empty.')
    const message = approve ? ['The plan is approved. Go ahead.', said].filter(Boolean).join('\n\n') : said

    // An agent the reader runs themselves is not started from here. It reads the message when it next asks.
    if (session.agent === 'mcp') {
      if (approve) session.planApproved = true
      session.messages.push({ role: 'you', text: message, tools: [] })
      await saveSession(contextDir, session)
      emit(session)
      return { started: session, finished: Promise.resolve(session) }
    }

    const turn = turns.get(id)
    if (turn) {
      // Mid-turn. An approval that waits does not count for what the agent is doing now.
      session.messages.push({ role: 'you', text: message, tools: [], waiting: true })
      session.queue.push({ text: message, approve })
      await saveSession(contextDir, session)
      emit(session)
      return { started: session, finished: turn.finished }
    }
    if (busy.has(contextDir)) throw new Error('Another agent is working in this context. Wait for it to finish.')

    // What was left waiting when the app was last closed goes first.
    const left = session.queue.splice(0)
    const soFar = conversation(session)
    for (const each of session.messages) delete each.waiting
    if (approve || left.some((each) => each.approve)) session.planApproved = true
    session.messages.push({ role: 'you', text: message, tools: [] })
    return await begin(contextDir, session, [...left.map((each) => each.text), message].join('\n\n'), soFar, emit)
  } finally {
    taken()
  }
}

/** One turn of the agent. The reader's message is already in the session. */
async function begin(
  contextDir: string,
  session: Session,
  message: string,
  soFar: string,
  emit: (session: Session) => void
): Promise<{ started: Session; finished: Promise<Session> }> {
  const { id, project } = session
  let settle!: (session: Session) => void
  const finished = new Promise<Session>((resolve) => (settle = resolve))
  turns.set(id, { session, finished })
  busy.add(contextDir)
  const release = () => {
    turns.delete(id)
    busy.delete(contextDir)
    watching.delete(contextDir)
    running.delete(id)
    session.running = false
  }

  const mayWrite = session.planApproved
  const answer: Message = { role: 'agent', text: '', tools: [] }
  session.messages.push(answer)
  session.running = true

  let child: ChildProcess
  let snapshot: Snapshot
  const adapter = AGENTS[session.agent as AgentKind]
  try {
    const state = mayWrite
      ? '[The plan is approved. You may edit files inside this project.]'
      : '[The plan is not approved yet. Read and propose. Do not edit any file.]'
    const projectDir = resolveInside(contextDir, 'projects', project)
    snapshot = await takeSnapshot(contextDir)
    // An agent on another machine is sent the files. One on this machine reads them itself.
    const files = session.host ? pack(snapshot, session.sent) : ''
    // An agent that can pick its conversation up again is told only what is new.
    // One that cannot is given the conversation so far.
    const prompt = session.agentSession
      ? [files && `These files are new or have changed:\n\n${files}`, state, message].filter(Boolean).join('\n\n')
      : [
          await firstWords(contextDir, project, session.host !== null),
          files && `The files of the context:\n\n${files}`,
          soFar && `The conversation so far:\n\n${soFar}`,
          state,
          message
        ]
          .filter(Boolean)
          .join('\n\n')

    watching.set(contextDir, snapshot)
    const turn = { cwd: projectDir, contextDir, resume: session.agentSession, mayWrite }
    child = session.host
      ? spawn(SSH.command, sshArgs(session.host, adapter.command, adapter.remoteArgs!(session.agentSession)), {
          env: agentEnvironment()
        })
      : spawn(adapter.command, adapter.args(turn), { cwd: projectDir, env: agentEnvironment() })
    running.set(id, child)
    child.stdin?.on('error', () => {})
    child.stdin?.end(prompt)
  } catch (caught) {
    session.messages.splice(session.messages.indexOf(answer), 1)
    release()
    settle(session)
    throw caught
  }

  let timer: NodeJS.Timeout | undefined
  const update = () => {
    timer ??= setTimeout(() => {
      timer = undefined
      emit(session)
    }, 120)
  }

  const errors: string[] = []
  let complaint = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    complaint = (complaint + chunk.toString()).slice(-600)
    // Some agents say on stderr which conversation this is.
    const named = /^session_id:\s*(\S+)/m.exec(chunk.toString())
    if (named) session.agentSession = named[1]
  })
  const read = (session.host && adapter.remoteRead) || adapter.read
  readline.createInterface({ input: child.stdout! }).on('line', (line) => {
    for (const event of read(line)) {
      if (event.type === 'session') session.agentSession = event.id
      if (event.type === 'text') answer.text += event.text
      if (event.type === 'tool') answer.tools.push(`${event.name} ${event.detail}`.trim())
      if (event.type === 'error') errors.push(event.message)
    }
    update()
  })

  let ended = false
  const end = async (failure?: string) => {
    if (ended) return
    ended = true
    clearTimeout(timer)
    answer.text = answer.text.trim()
    if (!answer.text && answer.tools.length === 0) session.messages.splice(session.messages.indexOf(answer), 1)
    if (failure) session.messages.push({ role: 'mate', text: failure, tools: [] })

    // An agent on this machine has changed the folder. One on another machine has said what it wants changed.
    const remote = session.host !== null
    const asked = remote ? await proposed(contextDir, answer.text) : { changes: await changesSince(contextDir, snapshot), refused: [] }
    if (remote) answer.text = answer.text.replace(FILE, (_, named: string) => `*(new text for \`${named.trim()}\`)*`)

    const putBack: string[] = []
    for (const change of asked.changes) {
      if ((await judge(contextDir, session, change, !remote)) === 'held') putBack.push(change.path)
    }
    if (putBack.length > 0) {
      const why = mayWrite ? 'outside this project' : 'before the plan was approved'
      const what = remote ? `asked to change ${putBack.join(', ')} ${why}.` : `changed ${putBack.join(', ')} ${why}. Mate put it back.`
      session.messages.push({ role: 'mate', text: `The agent ${what} The change is held: approve the file to let it through.`, tools: [] })
    }
    if (asked.refused.length > 0) {
      session.messages.push({ role: 'mate', text: `The agent named a file Mate will not write: ${asked.refused.join(', ')}.`, tools: [] })
    }

    // What waited behind this turn goes now, as one message. An approval in it counts from here.
    const waited = session.queue.splice(0)
    const earlier = conversation(session)
    for (const each of session.messages) delete each.waiting
    if (waited.some((each) => each.approve)) session.planApproved = true
    if (waited.length === 0) {
      release()
      await saveSession(contextDir, session).catch(() => {})
      emit(session)
      return settle(session)
    }
    // The session stays taken between the two turns, so a message sent just now waits too.
    try {
      const next = await begin(contextDir, session, waited.map((each) => each.text).join('\n\n'), earlier, emit)
      emit(session)
      settle(await next.finished)
    } catch (caught) {
      session.messages.push({ role: 'mate', text: (caught as Error).message, tools: [] })
      await saveSession(contextDir, session).catch(() => {})
      emit(session)
      settle(session)
    }
  }
  child.on('error', () => void end(`${adapter.label} is not on this computer, or could not be started.`))
  child.on('close', (code, signal) => {
    if (signal) return void end('Stopped.')
    const error = errors[errors.length - 1]
    if (error && /401|unauthori[sz]ed|not logged in/i.test(error)) {
      return void end(`${error}\n\n${adapter.label} is not signed in. Sign in to it in a terminal, then send the message again.`)
    }
    if (error) return void end(error)
    if (code !== 0) return void end(`${adapter.label} stopped with an error.${complaint ? `\n\n${complaint.trim()}` : ''}`)
    void end()
  })

  await saveSession(contextDir, session)
  return { started: session, finished }
}

export function stopTurn(id: string): void {
  running.get(id)?.kill()
}

/** Put a file back as it was before the agent changed it. What is there now is kept beside the backup. */
export async function revertChange(contextDir: string, project: string, id: string, index: number): Promise<Session> {
  const session = await loadSession(contextDir, project, id)
  const change = session.changes[index]
  if (!change || change.reverted) throw new Error('That change is not there to revert.')
  const dir = path.join(folder(contextDir, project, id), 'backups')
  const now = await readFile(path.join(contextDir, ...change.path.split('/'))).catch(() => null)
  await mkdir(dir, { recursive: true })
  if (now) await writeFile(path.join(dir, `${index}.reverted`), now)
  const before = change.backup === null ? null : await readFile(path.join(dir, change.backup))
  await put(contextDir, change.path, before)
  mateWrote(contextDir, change.path, before)
  change.reverted = true
  await saveSession(contextDir, session)
  return session
}

/** Let one held change through, or drop it. The approval is for this file, this once. */
export async function settleHeld(
  contextDir: string,
  project: string,
  id: string,
  index: number,
  approve: boolean
): Promise<Session> {
  const session = await loadSession(contextDir, project, id)
  const held = session.held[index]
  if (!held || held.state !== 'waiting') throw new Error('That change is not waiting for an answer.')
  if (approve) {
    const dir = folder(contextDir, project, id)
    const now = await readFile(path.join(contextDir, ...held.path.split('/'))).catch(() => null)
    const backup = now ? `${session.changes.length}` : null
    if (now) {
      await mkdir(path.join(dir, 'backups'), { recursive: true })
      await writeFile(path.join(dir, 'backups', backup!), now)
    }
    const after = held.file === null ? null : await readFile(path.join(dir, 'held', held.file))
    await put(contextDir, held.path, after)
    mateWrote(contextDir, held.path, after)
    session.changes.push({ path: held.path, backup, reverted: false })
  }
  held.state = approve ? 'approved' : 'discarded'
  await saveSession(contextDir, session)
  return session
}
