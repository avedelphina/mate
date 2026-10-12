import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type AgentKind = 'claude' | 'codex' | 'hermes'

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
}

type Adapter = {
  label: string
  command: string
  /** The message goes in on stdin, never on the command line. */
  args(turn: Turn): string[]
  /** One line of the agent's output. A line that is not an event gives nothing. */
  read(line: string): AgentEvent[]
}

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const short = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value ?? '')).slice(0, 200)

/**
 * Each agent is run without a terminal, with tools for reading and editing files and nothing else:
 * no shell, no web. What it may write is not left to the agent. The guard in guard.ts decides.
 */
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
      ...(turn.resume ? ['--resume', turn.resume] : [])
    ],
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
  const extra = [path.join(os.homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin']
  env.PATH = [env.PATH, ...extra].filter(Boolean).join(path.delimiter)
  return env
}

/** Which agents are on this computer. */
export function listAgents(): { kind: AgentKind; label: string; found: boolean }[] {
  const folders = (agentEnvironment().PATH ?? '').split(path.delimiter)
  return (Object.keys(AGENTS) as AgentKind[]).map((kind) => ({
    kind,
    label: AGENTS[kind].label,
    found: folders.some((folder) => existsSync(path.join(folder, AGENTS[kind].command)))
  }))
}
