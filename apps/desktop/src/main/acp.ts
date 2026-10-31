import { spawn, type ChildProcess } from 'node:child_process'
import readline from 'node:readline'

/**
 * A live conversation with an agent over the Agent Client Protocol: JSON-RPC, one message a
 * line, on the agent's stdin and stdout. Unlike an agent started once for each turn, this one
 * stays, so it can ask the reader before it does something, and be told something while it works.
 *
 * The frames are as Hermes Agent 0.21.5 sends them. Mate asks for no capability of its own: the
 * agent reads and writes with its own tools, and the guard looks at the folder afterwards.
 */

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** Where an agent reaches Mate's tools over MCP, and the token it shows there. */
export type Door = { url: string; token: string }

/** Something the agent will not do until the reader has said yes or no. */
/** `choices` is there when the agent asks a question with answers to pick from (Kimi). `kind` is what the agent says the step is: execute, edit, fetch and so on. */
export type Ask = { id: string; title: string; detail: string; choices?: { id: string; name: string }[]; kind?: string }

/** What a turn tells whoever started it. */
export type Hooks = {
  text(text: string): void
  /** One step the agent takes, as it names it. */
  step(step: string): void
  ask(ask: Ask): void
  /** An ask is over: answered, or the turn ended first. */
  asked(id: string): void
}

type Option = { kind?: string; optionId?: string; name?: string }

const short = (value: unknown, length: number) => (typeof value === 'string' ? value : JSON.stringify(value ?? '')).slice(0, length)

/** A model the agent can think with. `id` is the agent's own name for it, and only the agent reads it. */
export type Model = { id: string; name: string; from: string }
/** The models an agent offers, and the one it starts with. */
/** `efforts` is there when the agent can be told how hard to think while it stays. */
export type Models = { current: string; all: Model[]; efforts?: string[] }

function modelsOf(told: Json | undefined, options: Json[]): Models {
  // Kimi lists its models and its thinking among the options of the conversation, not as `models`.
  const option = (id: string) => options.find((each) => each?.id === id)
  const values = (id: string): Json[] => (Array.isArray(option(id)?.options) ? option(id)!.options : [])
  const efforts = values('thinking').map((each) => each?.value).filter((each): each is string => typeof each === 'string')
  if (!told && option('model')) {
    const all = values('model')
      .filter((each) => typeof each?.value === 'string')
      .map((each) => ({ id: each.value as string, name: short(each.name ?? each.value, 200), from: '' }))
    return { current: String(option('model')!.currentValue ?? ''), all, ...(efforts.length ? { efforts } : {}) }
  }
  const all = (Array.isArray(told?.availableModels) ? told.availableModels : [])
    .filter((each: Json) => typeof each?.modelId === 'string')
    .map((each: Json) => ({
      id: each.modelId as string,
      // Hermes puts the provider before some names and into the description of all of them.
      name: short(each.name ?? each.modelId, 200).replace(/^.* · /, ''),
      from: short(each.description ?? '', 200).replace(/^Provider: /, '').replace(/ • current$/, '')
    }))
  return { current: typeof told?.currentModelId === 'string' ? told.currentModelId : '', all }
}

/**
 * The reader's yes or no, as the agent wants it. Yes is only ever "this once": if the agent does
 * not offer that, the answer is no, so that nothing is allowed for good on the reader's behalf.
 */
export function outcome(options: Option[], allow: boolean, prefer?: string, choice?: string): Json {
  const of = (kind: string) => options.find((each) => each?.kind === kind && typeof each.optionId === 'string')
  // An answer to a question is one of the options offered, and only one that says yes once.
  // One that is not on offer is a no, so a made-up answer never becomes another.
  const chosen = allow && choice ? options.find((each) => each?.kind === 'allow_once' && each.optionId === choice) : undefined
  if (chosen) return { outcome: { outcome: 'selected', optionId: chosen.optionId } }
  if (allow && choice) allow = false
  // A no may name which of its no's it means.
  const named = !allow && prefer ? options.find((each) => each?.kind === 'reject_once' && each.optionId === prefer) : undefined
  const pick = named ?? (allow ? of('allow_once') : undefined) ?? of('reject_once')
  return pick ? { outcome: { outcome: 'selected', optionId: pick.optionId } } : { outcome: { outcome: 'cancelled' } }
}

export class Acp {
  readonly child: ChildProcess
  /** Whether the agent is told its model by `session/set_config_option` (Kimi) and not `session/set_model` (Hermes). */
  private configured = false
  private next = 0
  private readonly waiting = new Map<number, { resolve: (result: Json) => void; reject: (error: Error) => void }>()
  private readonly asks = new Map<string, { request: number | string; options: Option[] }>()
  private hooks: Hooks | null = null
  private sessionId = ''
  private complaint = ''
  private gone: Error | null = null
  /** What the agent echoes when it is steered. It is the reader's own words, so it is not shown twice. */
  private echo = ''

  /** What the agent offers to think with. Known once it is `ready`. */
  models: Models = { current: '', all: [] }
  /** The model the reader chose for this agent. Empty while it thinks with its own. */
  model = ''
  /** The thinking effort the reader chose, when the agent takes one while it stays. */
  effort = ''

  /** Settles when the agent has answered and a conversation is open. Until then nothing else is sent. */
  readonly ready: Promise<void>

  private constructor(child: ChildProcess, cwd: string, door: Door | null) {
    this.child = child
    child.stdin?.on('error', () => {})
    child.stderr?.on('data', (chunk: Buffer) => (this.complaint = (this.complaint + chunk.toString()).slice(-600)))
    readline.createInterface({ input: child.stdout! }).on('line', (line) => this.take(line))
    const end = (why: string) => {
      this.gone ??= new Error(why)
      for (const each of this.waiting.values()) each.reject(this.gone)
      this.waiting.clear()
    }
    child.on('error', () => end('The agent is not on this computer, or could not be started.'))
    child.on('close', (_code, signal) => end(signal ? 'Stopped.' : `The agent stopped.${this.complaint ? `\n\n${this.complaint.trim()}` : ''}`))
    this.ready = this.open(cwd, door)
    // Whoever starts a turn hears of a failure there. Nobody else has to.
    this.ready.catch(() => {})
  }

  /**
   * Start the agent in a folder. It is there at once, to be stopped, and `ready` when it can be spoken to.
   * `door` is Mate's door for it, which only reads: the agent gets its tools, search by meaning among them.
   */
  static start(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, door: Door | null = null): Acp {
    return new Acp(spawn(command, args, { cwd, env }), cwd, door)
  }

  private async open(cwd: string, door: Door | null): Promise<void> {
    await this.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'mate', version: '0' }
    })
    // ponytail: always a new conversation. `session/load` brings one back, but on Hermes 0.21.5 a
    // loaded session cannot reach a custom provider (401). Load it when that works.
    const mcpServers = door ? [{ type: 'http', name: 'mate', url: door.url, headers: [{ name: 'Authorization', value: `Bearer ${door.token}` }] }] : []
    const made = await this.request('session/new', { cwd, mcpServers })
    if (typeof made.sessionId !== 'string') throw new Error('The agent opened no conversation.')
    this.sessionId = made.sessionId
    this.configured = !made.models && Array.isArray(made.configOptions)
    this.models = modelsOf(made.models, this.configured ? made.configOptions : [])
  }

  get alive(): boolean {
    return this.gone === null
  }

  private send(message: Json): void {
    this.child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n')
  }

  private request(method: string, params: Json): Promise<Json> {
    if (this.gone) return Promise.reject(this.gone)
    return new Promise((resolve, reject) => {
      const id = ++this.next
      this.waiting.set(id, { resolve, reject })
      this.send({ id, method, params })
    })
  }

  /** One line from the agent: an answer to something Mate asked, news of the turn, or a question. */
  private take(line: string): void {
    let message: Json
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    if (!message || typeof message !== 'object') return
    if (typeof message.method !== 'string') {
      const pending = this.waiting.get(message.id)
      this.waiting.delete(message.id)
      if (message.error) pending?.reject(new Error(short(message.error.message ?? message.error, 300)))
      else pending?.resolve(message.result ?? {})
      return
    }
    const params: Json = message.params ?? {}
    // The agent tells every client about every conversation it has. Only this one is ours.
    if (params.sessionId !== this.sessionId) return
    if (message.method === 'session/update') return this.news(params.update ?? {})
    if (message.method === 'session/request_permission') {
      const call: Json = params.toolCall ?? {}
      const id = String(call.toolCallId ?? message.id)
      const input: Json = call.rawInput?.arguments ?? call.rawInput ?? {}
      const options: Option[] = Array.isArray(params.options) ? params.options : []
      this.asks.set(id, { request: message.id, options })
      // More than one way to say yes is a question: the answers are offered to the reader as they are.
      const yes = options.filter((each) => each?.kind === 'allow_once' && typeof each.optionId === 'string')
      const choices = yes.length > 1 ? yes.map((each) => ({ id: each.optionId!, name: short(each.name ?? each.optionId, 200) })) : undefined
      // With nobody to ask, the answer is no.
      if (!this.hooks) return this.answer(id, false)
      // Kimi names no command or path, only what it wants to do in words.
      const said = call.content?.[0]?.content?.text
      return this.hooks.ask({ id, title: short(call.title ?? 'The agent asks to go on', 200), detail: short(input.command ?? input.path ?? said ?? '', 20_000), ...(choices ? { choices } : {}), ...(typeof call.kind === 'string' ? { kind: short(call.kind, 40) } : {}) })
    }
    // Mate offers the agent nothing else, and says so if it is asked.
    if (message.id !== undefined) this.send({ id: message.id, error: { code: -32601, message: 'Mate does not do that.' } })
  }

  private news(update: Json): void {
    if (!this.hooks) return
    if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') this.hooks.text(String(update.content.text ?? ''))
    if (update.sessionUpdate === 'tool_call' && typeof update.title === 'string') this.hooks.step(short(update.title, 200))
  }

  /** The agent's mode: whether edits need the reader's yes each time (`default`) or go through (`accept_edits`), or its own plan mode. The guard rules either way. */
  async mode(id: string): Promise<void> {
    await this.request('session/set_mode', { sessionId: this.sessionId, modeId: id })
  }

  /** Think with another model from here on. The agent takes it only between turns. */
  async setModel(id: string): Promise<void> {
    if (this.configured) await this.request('session/set_config_option', { sessionId: this.sessionId, configId: 'model', value: id })
    else await this.request('session/set_model', { sessionId: this.sessionId, modelId: id })
    this.model = id
  }

  /** Think this hard from here on. Only an agent that lists efforts takes one. */
  async setEffort(value: string): Promise<void> {
    await this.request('session/set_config_option', { sessionId: this.sessionId, configId: 'thinking', value })
    this.effort = value
  }

  /** One turn. It ends when the agent stops. What is still asked then is over. */
  async turn(text: string, hooks: Hooks): Promise<void> {
    this.hooks = hooks
    try {
      await this.request('session/prompt', { sessionId: this.sessionId, prompt: [{ type: 'text', text }] })
    } finally {
      for (const id of [...this.asks.keys()]) this.answer(id, false)
      this.hooks = null
      this.echo = ''
    }
  }

  /** Say something to the agent while it works. It takes it into the turn it is in. */
  async steer(text: string): Promise<void> {
    this.echo = `⏩ Steer queued for the active turn: ${text}`
    await this.request('session/prompt', { sessionId: this.sessionId, prompt: [{ type: 'text', text: `/steer ${text}` }] })
  }

  /** The agent's own note that it was steered, when `text` holds it. */
  withoutEcho(text: string): string {
    return this.echo ? text.replace(this.echo, '') : text
  }

  answer(id: string, allow: boolean, prefer?: string, choice?: string): void {
    const ask = this.asks.get(id)
    if (!ask) return
    this.asks.delete(id)
    this.send({ id: ask.request, result: outcome(ask.options, allow, prefer, choice) })
    this.hooks?.asked(id)
  }

  close(): void {
    this.gone ??= new Error('Stopped.')
    this.child.stdin?.end()
    this.child.kill()
  }
}
