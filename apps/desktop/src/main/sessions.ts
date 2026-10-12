import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'
import { AGENTS, agentEnvironment, type AgentKind } from './agents'
import { resolveInside } from './context'
import { changesSince, mateWrote, put, takeSnapshot, watching } from './guard'

export type Message = { role: 'you' | 'agent' | 'mate'; text: string; tools: string[] }

/** A file the agent changed and Mate let through. `backup` names the bytes from before. Null: there was no file. */
export type Kept = { path: string; backup: string | null; reverted: boolean }

/** A change Mate put back and holds. `file` names the agent's bytes. Null: the agent deleted the file. */
export type Held = { path: string; file: string | null; state: 'waiting' | 'approved' | 'discarded' }

/** A conversation with one agent, inside one project. It is a file in the context, so it outlives the window. */
export type Session = {
  id: string
  project: string
  agent: AgentKind
  created: string
  /** The agent's own id for the conversation. With it the agent picks up where it stopped. */
  agentSession: string | null
  planApproved: boolean
  messages: Message[]
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

const folder = (contextDir: string, project: string, id = '') =>
  resolveInside(path.join(contextDir, '.sessions'), project, id)

async function save(contextDir: string, session: Session): Promise<void> {
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
  const session = JSON.parse(await readFile(path.join(folder(contextDir, project, id), 'session.json'), 'utf8')) as Session
  return { ...session, running: running.has(id) }
}

/** The sessions of a project, the newest first. */
export async function listSessions(contextDir: string, project: string): Promise<Session[]> {
  const ids = await readdir(folder(contextDir, project)).catch(() => [])
  const sessions = await Promise.all(ids.map((id) => loadSession(contextDir, project, id).catch(() => null)))
  return sessions.filter((session) => session !== null).sort((a, b) => b.created.localeCompare(a.created))
}

export async function startSession(contextDir: string, project: string, agent: AgentKind): Promise<Session> {
  if (!AGENTS[agent]) throw new Error('That agent is not one Mate knows.')
  const session: Session = {
    id: randomUUID(),
    project,
    agent,
    created: new Date().toISOString(),
    agentSession: null,
    planApproved: false,
    messages: [],
    changes: [],
    held: [],
    running: false
  }
  await save(contextDir, session)
  return session
}

const running = new Map<string, ChildProcess>()
async function firstWords(contextDir: string, project: string): Promise<string> {
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
 * Send one message and let the agent answer. An approval is a message too.
 * `started` is the session as the turn begins. `finished` settles when the agent has stopped
 * and the guard has been through the folder.
 */
export async function sendMessage(
  contextDir: string,
  project: string,
  id: string,
  text: string,
  approve: boolean,
  emit: (session: Session) => void
): Promise<{ started: Session; finished: Promise<Session> }> {
  const session = await loadSession(contextDir, project, id)
  const said = text.trim()
  if (running.has(id)) throw new Error('The agent is still answering.')
  if (watching.has(contextDir)) throw new Error('Another agent is working in this context. Wait for it to finish.')
  if (!said && !approve) throw new Error('The message is empty.')

  const earlier = session.messages.filter((message) => message.role !== 'mate')
  if (approve) session.planApproved = true
  const mayWrite = session.planApproved
  const message = approve ? ['The plan is approved. Go ahead.', said].filter(Boolean).join('\n\n') : said
  const answer: Message = { role: 'agent', text: '', tools: [] }
  session.messages.push({ role: 'you', text: message, tools: [] }, answer)
  session.running = true

  const state = mayWrite
    ? '[The plan is approved. You may edit files inside this project.]'
    : '[The plan is not approved yet. Read and propose. Do not edit any file.]'
  // An agent that can pick its conversation up again is told only what is new.
  // One that cannot is given the conversation so far.
  const soFar = earlier.map((each) => `${each.role === 'you' ? 'Reviewer' : 'You'}: ${each.text}`).join('\n\n')
  const prompt = session.agentSession
    ? `${state}\n\n${message}`
    : [await firstWords(contextDir, project), soFar && `The conversation so far:\n\n${soFar}`, state, message]
        .filter(Boolean)
        .join('\n\n')

  const adapter = AGENTS[session.agent]
  const projectDir = resolveInside(contextDir, 'projects', project)
  const snapshot = await takeSnapshot(contextDir)
  watching.set(contextDir, snapshot)
  const turn = { cwd: projectDir, contextDir, resume: session.agentSession, mayWrite }
  const child = spawn(adapter.command, adapter.args(turn), { cwd: projectDir, env: agentEnvironment() })
  running.set(id, child)

  let timer: NodeJS.Timeout | undefined
  const update = () => {
    timer ??= setTimeout(() => {
      timer = undefined
      emit(session)
    }, 120)
  }

  const errors: string[] = []
  let complaint = ''
  child.stderr.on('data', (chunk: Buffer) => (complaint = (complaint + chunk.toString()).slice(-600)))
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    for (const event of adapter.read(line)) {
      if (event.type === 'session') session.agentSession = event.id
      if (event.type === 'text') answer.text += event.text
      if (event.type === 'tool') answer.tools.push(`${event.name} ${event.detail}`.trim())
      if (event.type === 'error') errors.push(event.message)
    }
    update()
  })
  child.stdin.on('error', () => {})
  child.stdin.end(prompt)

  const finished = new Promise<Session>((resolve) => {
    let ended = false
    const end = async (failure?: string) => {
      if (ended) return
      ended = true
      clearTimeout(timer)
      answer.text = answer.text.trim()
      if (!answer.text && answer.tools.length === 0) session.messages.splice(session.messages.indexOf(answer), 1)
      if (failure) session.messages.push({ role: 'mate', text: failure, tools: [] })

      const putBack: string[] = []
      for (const change of await changesSince(contextDir, snapshot)) {
        const dir = folder(contextDir, project, id)
        if (mayWrite && change.path.startsWith(`projects/${project}/`)) {
          // The agent's work. The bytes from before are kept, so Revert can put them back.
          const backup = change.before ? `${session.changes.length}` : null
          if (change.before) {
            await mkdir(path.join(dir, 'backups'), { recursive: true })
            await writeFile(path.join(dir, 'backups', backup!), change.before)
          }
          session.changes.push({ path: change.path, backup, reverted: false })
        } else {
          // Not the agent's to change, or not yet. The file goes back, and the change waits for the reader.
          const file = change.after ? `${session.held.length}` : null
          if (change.after) {
            await mkdir(path.join(dir, 'held'), { recursive: true })
            await writeFile(path.join(dir, 'held', file!), change.after)
          }
          await put(contextDir, change.path, change.before)
          session.held.push({ path: change.path, file, state: 'waiting' })
          putBack.push(change.path)
        }
      }
      if (putBack.length > 0) {
        const why = mayWrite ? 'outside this project' : 'before the plan was approved'
        session.messages.push({
          role: 'mate',
          text: `The agent changed ${putBack.join(', ')} ${why}. Mate put it back. The change is held: approve the file to let it through.`,
          tools: []
        })
      }

      watching.delete(contextDir)
      running.delete(id)
      session.running = false
      await save(contextDir, session).catch(() => {})
      emit(session)
      resolve(session)
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
  })

  await save(contextDir, session)
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
  await save(contextDir, session)
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
  await save(contextDir, session)
  return session
}
