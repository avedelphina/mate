import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EFFORTS } from '../shared/effort'
import { PROFILE, preparePrivate } from './endpoint'

export type AgentKind = 'claude' | 'codex' | 'kimi' | 'hermes' | 'private'

/** What an agent said or did, whichever agent it is. */
export type AgentEvent =
  | { type: 'session'; id: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; detail: string }
  | { type: 'error'; message: string }

export type Turn = {
  /** The project folder. The agent works here. */
  cwd: string
  contextDir: string
  /** The agent's own id for this conversation, from an earlier turn. */
  resume: string | null
  /** False until the reviewer has approved the plan. */
  mayWrite: boolean
  /** The model and the thinking effort the reader chose, when they did. See `isModel` and shared/effort.ts. */
  model?: string
  effort?: string
}

/**
 * A model as an agent names it, such as `openrouter:anthropic/claude-sonnet-4.6`. It becomes a word
 * on a command line and a session file may carry any text, so it is checked where it is used: it
 * must not read as an option.
 */
export const isModel = (model: unknown): model is string =>
  typeof model === 'string' && model.length <= 200 && /^[A-Za-z0-9][^\s\0]*$/.test(model)

type Adapter = {
  label: string
  command: string
  /** The message goes in on stdin, never on the command line. */
  args(turn: Turn): string[]
  /**
   * The arguments that start the agent speaking the Agent Client Protocol, with all its own tools.
   * It is started this way only in a context the reader trusts. See acp.ts and trust.ts.
   */
  acp?: string[]
  /**
   * Set for an agent that can be held to file tools only by nothing but its own command line, and has no
   * such way here. It is started in a context the reader trusts and in no other.
   */
  trustedOnly?: boolean
  /** Whether a message can be put into a turn while the agent works (Hermes `/steer`). Else it waits behind the turn. */
  steers?: boolean
  /**
   * The agent's own modes over ACP, for a turn before the plan is approved and for one after. Without
   * this, `default` asks before every edit and `accept_edits` lets edits through.
   */
  modes?: { plan: string; write: string }
  /**
   * The ask with which the agent shows a plan it made in its plan mode. Mate puts the plan into the
   * answer, where the reader approves it as any other, and says `no` with the option that ends the
   * plan mode: "revise" makes the agent send the plan again and again.
   */
  planAsk?: { title: string; no: string }
  /**
   * The titles under which the agent asks to change a file. Once the plan is approved, Mate says yes to
   * these, as `accept_edits` does for Hermes. It asks the reader about everything else.
   */
  edits?: string[]
  /**
   * The arguments on another machine, where the agent has no folder and is given no file tools.
   * Only an agent that has this can be invited over SSH.
   */
  remoteArgs?(resume: string | null): string[]
  /** One line of what the agent prints on another machine, when that is not what it prints here. */
  remoteRead?(line: string): AgentEvent[]
  /** One line of the agent's output. A line that is not an event gives nothing. */
  read(line: string): AgentEvent[]
  /** What the agent runs inside, set up first: the words of the command line before its own. */
  within?(env: NodeJS.ProcessEnv, turn: Turn): Promise<string[]>
}

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const short = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value ?? '')).slice(0, 200)

/**
 * Each agent is run without a terminal, with tools for reading and editing files and nothing else:
 * no shell, no web. What it may write is not left to the agent. The guard in guard.ts decides.
 *
 * In a context the reader trusts, Hermes is not held to that: it runs with the tools it has in the
 * reader's own terminal, and asks the reader before what it would ask there. The guard still rules
 * on the context folder, and sees nothing outside it.
 */
// ponytail: trust changes Hermes only. Claude and Codex keep their limits in every context.
// Give each its own `acp` when someone works with them that way.
export const AGENTS: Record<AgentKind, Adapter> = {
  claude: {
    label: 'Claude',
    command: 'claude',
    args: (turn) => [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      turn.mayWrite ? 'acceptEdits' : 'plan',
      '--tools',
      'Read,Glob,Grep,Edit,Write',
      '--add-dir',
      turn.contextDir,
      // The context may come from someone else's repository. Its own settings and hooks are not run,
      // and the reader's plugins do not see what is said here.
      '--strict-mcp-config',
      '--setting-sources',
      '',
      ...(turn.resume ? ['--resume', turn.resume] : [])
    ],
    read(line) {
      const event = parse(line)
      if (event.type === 'system' && event.subtype === 'init') return [{ type: 'session', id: String(event.session_id) }]
      if (event.type === 'result' && event.is_error) return [{ type: 'error', message: short(event.result) }]
      if (event.type !== 'assistant') return []
      const blocks: Json[] = event.message?.content ?? []
      return blocks.flatMap((block): AgentEvent[] => {
        if (block.type === 'text') return [{ type: 'text', text: block.text + '\n\n' }]
        if (block.type !== 'tool_use') return []
        const input: Json = block.input ?? {}
        return [{ type: 'tool', name: block.name, detail: short(input.file_path ?? input.pattern ?? input.path ?? input) }]
      })
    }
  },

  codex: {
    label: 'Codex',
    command: 'codex',
    args: (turn) => [
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--sandbox',
      turn.mayWrite ? 'workspace-write' : 'read-only',
      '-C',
      turn.cwd,
      ...(turn.resume ? ['resume', turn.resume] : []),
      '-'
    ],
    read(line) {
      const message: Json = parse(line).msg ?? {}
      switch (message.type) {
        case 'session_configured':
          return [{ type: 'session', id: String(message.session_id) }]
        case 'agent_message':
          return [{ type: 'text', text: message.message + '\n\n' }]
        case 'exec_command_begin':
          return [{ type: 'tool', name: 'shell', detail: short([message.command].flat().join(' ')) }]
        case 'patch_apply_begin':
          return [{ type: 'tool', name: 'edit', detail: short(Object.keys(message.changes ?? {}).join(', ')) }]
        case 'error':
          return [{ type: 'error', message: short(message.message) }]
        default:
          return []
      }
    }
  },

  // `kimi acp` takes no list of tools: it has a shell and the web whatever its agent file says, and in
  // its `auto` mode it runs them unasked. So it stays between turns, in a trusted context only, and
  // asks before every step but a read.
  kimi: {
    label: 'Kimi',
    command: 'kimi',
    args: () => {
      throw new Error('Kimi works only in a context you trust.')
    },
    read: () => [],
    acp: ['acp'],
    trustedOnly: true,
    edits: ['Write', 'Edit'],
    // Its plan mode reads and writes nothing in the folder; it saves the plan where its sessions are.
    modes: { plan: 'plan', write: 'default' },
    planAsk: { title: 'ExitPlanMode', no: 'plan_reject_and_exit' }
  },

  hermes: {
    label: 'Hermes',
    command: 'hermes',
    args: (turn) => [
      'chat',
      '--query-file',
      '-',
      '--format',
      'stream-json',
      '--in',
      turn.cwd,
      '--source',
      'tool',
      '-t',
      'file',
      // Hermes reads the provider out of the model's name itself.
      ...(isModel(turn.model) ? ['-m', turn.model] : []),
      ...(turn.effort && EFFORTS.includes(turn.effort) ? ['--reasoning', turn.effort] : []),
      ...(turn.resume ? ['--resume', turn.resume] : [])
    ],
    acp: ['acp'],
    steers: true,
    // `todo` is a toolset that touches nothing. Hermes must not read or write the other machine's files.
    // Quiet text, not the event stream: an older Hermes on the other machine does not have the stream.
    // In quiet mode the answer is all that is printed, and the session id goes to stderr.
    remoteArgs: (resume) => [
      'chat',
      '-Q',
      '--query-file',
      '-',
      '--source',
      'tool',
      '-t',
      'todo',
      ...(resume ? ['--resume', resume] : [])
    ],
    remoteRead: (line) => [{ type: 'text', text: line + '\n' }],
    read(line) {
      const event = parse(line)
      switch (event.type) {
        case 'system':
          return event.session_id ? [{ type: 'session', id: String(event.session_id) }] : []
        case 'text':
          return [{ type: 'text', text: String(event.text) }]
        case 'tool_use':
          return [{ type: 'tool', name: event.name, detail: short(event.input?.path ?? event.input) }]
        case 'error':
          return [{ type: 'error', message: short(event.message ?? event.error) }]
        case 'result':
          return event.exit_code ? [{ type: 'error', message: short(event.text || 'Hermes stopped with an error.') }] : []
        default:
          return []
      }
    }
  },

  // Hermes on the reader's own endpoint, in a private context that allows it. The platform sandbox
  // lets it reach Mate's relay and nothing else, under Mate's own profile: the reader's may fall
  // back to the cloud. Files only, whatever the trust, and the model is the endpoint's.
  private: {
    label: 'Hermes on your endpoint',
    command: 'hermes',
    args: (turn) => ['-p', PROFILE, ...AGENTS.hermes.args({ ...turn, model: undefined, effort: undefined })],
    within: (env, turn) => preparePrivate(env, turn.contextDir),
    read: (line) => AGENTS.hermes.read(line)
  }
}

function parse(line: string): Json {
  try {
    const value = JSON.parse(line)
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

/**
 * The environment an agent is started in. A window opened from the Finder has a short PATH, so
 * the usual places for these tools are added. What marks this process as Electron, or as running
 * inside another agent, is taken out.
 */
export function agentEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const name of ['ELECTRON_RUN_AS_NODE', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT']) delete env[name]
  const extra = [path.join(os.homedir(), '.local/bin'), path.join(os.homedir(), '.kimi-code/bin'), '/opt/homebrew/bin', '/usr/local/bin']
  env.PATH = [env.PATH, ...extra].filter(Boolean).join(path.delimiter)
  return env
}

/** A test puts a stand-in here. */
export const SSH = { command: 'ssh' }

/** A host name as ssh takes it. Nothing that ssh could read as an option. */
export const isHost = (host: string) => /^[A-Za-z0-9][A-Za-z0-9._@-]*$/.test(host)

/** Run a command on another machine. ssh hands the words to a shell there, so each one is quoted. */
export function sshArgs(host: string, command: string, args: string[]): string[] {
  if (!isHost(host)) throw new Error('That is not a host name.')
  const quoted = [command, ...args].map((word) => `'${word.replace(/'/g, `'\\''`)}'`)
  return ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host, '--', ...quoted]
}

/** The hosts named in the reader's ssh config. A pattern such as `*` is not a host. */
function listHosts(): string[] {
  try {
    const config = readFileSync(path.join(os.homedir(), '.ssh', 'config'), 'utf8')
    const names = [...config.matchAll(/^[ \t]*Host[ \t]+(.+)$/gim)].flatMap((match) => match[1].trim().split(/\s+/))
    return [...new Set(names)].filter(isHost)
  } catch {
    return []
  }
}

export type AgentInfo = { kind: AgentKind; label: string; found: boolean; host: string | null }

/** Where to look for agents: the PATH of this computer, or the hosts in the reader's ssh config. */
export type Way = 'here' | 'ssh'

/** What a way finds. Those on this computer are offered as they are; those over ssh the reader picks from. */
export function discoverAgents(way: Way): AgentInfo[] {
  const kinds = Object.keys(AGENTS) as AgentKind[]
  if (way === 'ssh')
    return listHosts().flatMap((host) =>
      kinds.filter((kind) => AGENTS[kind].remoteArgs).map((kind) => ({ kind, label: `${AGENTS[kind].label} on ${host}`, found: true, host }))
    )
  const folders = (agentEnvironment().PATH ?? '').split(path.delimiter)
  const present = (command: string) => folders.some((folder) => existsSync(path.join(folder, command)))
  return kinds.map((kind) => ({
    kind,
    label: AGENTS[kind].label,
    found:
      present(AGENTS[kind].command) &&
      (kind !== 'private' || process.platform === 'darwin' || (process.platform === 'linux' && present('bwrap') && present('python3'))),
    host: null
  }))
}

/** Whether the reader may add this agent: a known kind, and a host only for a kind that can be reached over ssh. */
export function addable(kind: unknown, host: unknown): host is string | null {
  if (typeof kind !== 'string' || !Object.hasOwn(AGENTS, kind)) return false
  if (host === null) return true
  return typeof host === 'string' && isHost(host) && !!AGENTS[kind as AgentKind].remoteArgs
}

/** An agent on another machine the reader added. The host is not asked: ssh finds out when the agent starts. */
export function describeAgent(kind: AgentKind, host: string): AgentInfo {
  return { kind, label: `${AGENTS[kind].label} on ${host}`, found: true, host }
}
