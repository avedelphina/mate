import { execFile } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { isModel } from './agents'

/**
 * The reader's own inference endpoint, for a private context that may use one. Hermes is the agent,
 * but it never reaches the endpoint itself:
 *
 * - It runs in a platform sandbox with no network but Mate's relay on this computer.
 * - The relay forwards to the endpoint the reader set, and to nothing else, and adds the key there.
 *   Hermes holds only a token for the relay, good while the app runs.
 * - It runs under a Hermes profile of Mate's own, `mate-private`, with no fallback providers, no
 *   plugins, no memory and file tools only. The reader's own profile may fall back to the cloud.
 *
 * The sandbox cannot allow one remote host, only this computer or every host, so the relay is what
 * names the endpoint. Whatever the profile says, nothing else is reachable.
 */

/** Encrypts the key at rest. Electron's safeStorage in the app (the system keychain), a stand-in in the tests. */
export type Seal = { encrypt(text: string): Buffer; decrypt(sealed: Buffer): string }

type Stored = { url: string; model: string; key?: string }

/**
 * Why a key may not be kept here, or null when it may. On Linux without a keyring, Electron falls back
 * to a store sealed with a password that is the same on every computer: that is no seal at all.
 */
export function keyRefusal(platform: string, available: boolean, backend: string): string | null {
  if (!available) return 'Keep an endpoint key only where the system keychain is available.'
  if (platform === 'linux' && (backend === 'basic_text' || backend === 'unknown')) {
    return 'Keep an endpoint key only where a keyring runs, such as GNOME Keyring or KWallet. Without one, the key would be sealed with a password every computer knows.'
  }
  return null
}

/** What the window may know: never the key. */
export type EndpointView = { url: string; model: string; hasKey: boolean }

export const PROFILE = 'mate-private'

let file: string | null = null
let seal: Seal | null = null
let stored: Stored | null = null

/** Where the endpoint is kept, in the app's data folder. One that is missing or damaged is no endpoint. */
export function keepEndpointIn(where: string, sealer: Seal): void {
  ;[file, seal] = [where, sealer]
  try {
    const read = JSON.parse(readFileSync(where, 'utf8')) as Stored
    stored = typeof read.url === 'string' && typeof read.model === 'string' ? read : null
  } catch {
    stored = null
  }
}

export const endpointView = (): EndpointView | null => (stored ? { url: stored.url, model: stored.model, hasKey: Boolean(stored.key) } : null)

/**
 * The address must be https, or on this computer: the text of a private context does not cross a
 * network in clear text. It is the base of an OpenAI-compatible API, such as https://host/v1.
 */
export function checkEndpoint(url: string, model: string): URL {
  let parsed: URL
  try {
    parsed = new URL(String(url).trim())
  } catch {
    throw new Error('That is not an address. It looks like https://your-server/v1.')
  }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) throw new Error('The address must begin with https://, unless it is on this computer.')
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Give the address alone: no name, password or query in it.')
  if (!isModel(model)) throw new Error('Give the name of the model as the endpoint knows it.')
  return parsed
}

/** Save the endpoint. A key left empty keeps the one saved before. Gives whether the host changed. */
export function setEndpoint(url: string, model: string, key?: string): boolean {
  const parsed = checkEndpoint(url, model)
  const before = stored ? new URL(stored.url).host : null
  const next: Stored = { url: parsed.href.replace(/\/$/, ''), model: model.trim() }
  if (key) next.key = seal!.encrypt(key).toString('base64')
  else if (stored?.key && before === parsed.host) next.key = stored.key
  stored = next
  if (file) writeFileSync(file, JSON.stringify(stored, null, 2), { mode: 0o600 })
  return before !== parsed.host
}

/** The SBPL profile for `sandbox-exec`: no network out, but the relay's port on this computer. */
export const sandboxProfile = (port: number): string =>
  `(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:${Number(port)}"))`

/** The endpoint's key, as a header. Only main ever holds it. */
const keyHeader = (): Record<string, string> => (stored?.key ? { authorization: `Bearer ${seal!.decrypt(Buffer.from(stored.key, 'base64'))}` } : {})

let relay: { port: number; socket: string; token: string; close(): void } | null = null

/** The relay, on TCP for the Mac sandbox and a Unix socket for Linux. Every request needs its token. */
export async function startRelay(): Promise<{ port: number; socket: string; token: string }> {
  if (relay) return relay
  const token = randomBytes(24).toString('hex')
  const expected = Buffer.from(`Bearer ${token}`)
  const handler: http.RequestListener = async (request, response) => {
    const given = Buffer.from(String(request.headers.authorization ?? ''))
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return response.writeHead(401).end()
    if (request.headers.origin) return response.writeHead(403).end()
    if (!stored) return response.writeHead(503).end('No endpoint is set in Mate.')
    // The path after /v1 goes to the same path after the endpoint's base. Nothing can name another host.
    // Hermes also asks paths of Ollama and llama.cpp outside /v1: they are not the endpoint's API.
    const asked = String(request.url ?? '/')
    if (!/^\/v1(\/|$)/.test(asked)) return response.writeHead(404).end()
    const rest = asked.slice('/v1'.length)
    if (rest.includes('..')) return response.writeHead(400).end()
    try {
      const answer = await fetch(stored.url + rest, {
        method: request.method,
        headers: {
          'content-type': String(request.headers['content-type'] ?? 'application/json'),
          accept: String(request.headers.accept ?? '*/*'),
          ...keyHeader()
        },
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : (Readable.toWeb(request) as ReadableStream),
        duplex: 'half',
        redirect: 'error'
      } as RequestInit)
      response.writeHead(answer.status, { 'content-type': answer.headers.get('content-type') ?? 'application/json' })
      if (answer.body) Readable.fromWeb(answer.body as never).pipe(response)
      else response.end()
    } catch {
      if (!response.headersSent) response.writeHead(502)
      response.end()
    }
  }
  const server = http.createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mate-relay-'))
  const socket = path.join(dir, 'endpoint.sock')
  const local = http.createServer(handler)
  try {
    await new Promise<void>((resolve) => local.listen(socket, resolve))
  } catch (failed) {
    server.close()
    await rm(dir, { recursive: true, force: true })
    throw failed
  }
  relay = {
    port,
    socket,
    token,
    close: () => {
      server.close()
      local.close()
      void rm(dir, { recursive: true, force: true })
    }
  }
  return relay
}

export function stopRelay(): void {
  relay?.close()
  relay = null
}

/** Where Hermes keeps a profile. */
export const profileDir = (home = os.homedir()) => path.join(home, '.hermes', 'profiles', PROFILE)

/** The profile Hermes runs under: the relay as its only provider, and nothing that could reach further. */
export function profileConfig(port: number, token: string, model: string): string {
  return [
    '# Written by Mate on every private turn. Changes here are written over.',
    'model:',
    `  default: ${JSON.stringify(model)}`,
    '  provider: custom:mate-relay',
    '  transport: chat_completions',
    '  api_mode: chat_completions',
    'providers:',
    '  mate-relay:',
    `    api: http://127.0.0.1:${port}/v1`,
    // `api_key`: Hermes sends `key` nowhere and says no-key-required instead.
    `    api_key: ${token}`,
    `    default_model: ${JSON.stringify(model)}`,
    '    transport: chat_completions',
    'fallback_providers: []',
    'gateway:',
    '  standalone: true',
    'toolsets:',
    '  - file',
    'plugins:',
    '  enabled: []',
    'memory:',
    '  memory_enabled: false',
    '  user_profile_enabled: false',
    'telemetry:',
    '  shared_metrics:',
    '    enabled: false',
    ''
  ].join('\n')
}

export const linuxRelay = { helper: 'assist/linux-relay.py', port: 41759 }

/** No network namespace of its own can reach the host's TCP relay, so Linux uses its Unix socket. */
// A Unix socket is not network: `--unshare-net` alone leaves every one on the host open, and the D-Bus
// session bus, an ssh connection socket or a Docker socket is a way out. Home and the common socket folders
// are empty. Only the context, the private Hermes profile and its runtime, and the relay are bound back.
// Current Hermes needs its own gateway socket, so a syscall filter cannot close every other Unix socket.
const HIDDEN = ['/tmp', '/run', '/var/tmp', os.homedir()]
const POINTERS = ['DBUS_SESSION_BUS_ADDRESS', 'SSH_AUTH_SOCK', 'GPG_AGENT_INFO', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR']

/** A folder that is there, and not a link: bwrap would mount on what a link points at. */
const isFolder = (where: string): boolean => {
  try {
    const info = lstatSync(where)
    return info.isDirectory() && !info.isSymbolicLink()
  } catch {
    return false
  }
}

/** Socket files brought in with a context are replaced by /dev/null, without following directory links. */
function socketsIn(root: string): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const where = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(where)
      else if (entry.isSocket()) found.push(where)
    }
  }
  try {
    walk(root)
  } catch {}
  return found
}

/** The command that encloses Hermes on Linux. Only `writable` folders may change; `readable` is bound back. */
export function linuxSandbox(socket: string, writable: string[] = [], readable: string[] = []): string[] {
  const helper = path.resolve(linuxRelay.helper)
  return [
    'bwrap',
    '--ro-bind',
    '/',
    '/',
    '--dev',
    '/dev',
    '--proc',
    '/proc',
    ...HIDDEN.filter(isFolder).flatMap((where) => ['--tmpfs', where]),
    ...[...writable.filter(isFolder), path.dirname(socket)].flatMap((where) => ['--dir', path.dirname(where), '--bind', where, where]),
    ...readable.filter(isFolder).flatMap((where) => ['--dir', path.dirname(where), '--ro-bind', where, where]),
    ...socketsIn(writable[0] ?? '').flatMap((where) => ['--ro-bind', '/dev/null', where]),
    '--dir',
    path.dirname(helper),
    '--ro-bind',
    helper,
    helper,
    ...POINTERS.flatMap((name) => ['--unsetenv', name]),
    '--unshare-net',
    '--unshare-ipc',
    '--new-session',
    '--die-with-parent',
    '--',
    'python3',
    helper,
    '--socket',
    socket,
    '--port',
    String(linuxRelay.port),
    '--'
  ]
}

/** Before a private turn: the relay runs, the profile names it, and the command encloses Hermes. */
export async function preparePrivate(env: NodeJS.ProcessEnv, contextDir: string): Promise<string[]> {
  if (!stored) throw new Error('Set your endpoint first, in the Agent tab.')
  const running = await startRelay()
  const linux = process.platform === 'linux'
  const port = linux ? linuxRelay.port : running.port
  const dir = profileDir()
  // Hermes makes a profile with its own command. It copies the reader's config, which is written over at once.
  if (!existsSync(dir)) {
    await new Promise<void>((resolve, reject) =>
      execFile('hermes', ['profile', 'create', PROFILE, '--no-alias', '--no-skills'], { env, timeout: 60_000 }, (failed) => (failed ? reject(failed) : resolve()))
    )
  }
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'config.yaml'), profileConfig(port, running.token, stored.model), { mode: 0o600 })
  if (linux) {
    env.HERMES_GATEWAY_LOCK_DIR = path.join(dir, 'gateway-locks')
    const home = `${os.homedir()}${path.sep}`
    const pathFolders = (env.PATH ?? '').split(path.delimiter).filter((where) => where.startsWith(home))
    const runtime = ['hermes-agent', 'tools'].map((each) => path.join(os.homedir(), '.hermes', each))
    const installs = path.join(os.homedir(), '.hermes', 'installs')
    return linuxSandbox(running.socket, [contextDir, dir, installs], [...pathFolders, ...runtime])
  }
  if (process.platform === 'darwin') return ['/usr/bin/sandbox-exec', '-p', sandboxProfile(running.port)]
  throw new Error('Hermes on your endpoint needs the macOS sandbox, or Bubblewrap on Linux.')
}

const JUDGE = [
  'You judge which passages of a library bear on a text the reader gives: a question, or a passage of a draft.',
  'You do not answer it, and you do not write about it.',
  'A passage bears on the text when it answers it, sets a rule or a limit that applies to what the text says or plans, or says something that contradicts it.',
  'The text and the passages may be in English, Czech or Slovak.',
  'Reply with JSON only, and nothing else: {"relevant": [the numbers of the relevant passages, the most relevant first]}. If none is, {"relevant": []}.'
].join('\n')

/**
 * Ask the reader's endpoint which passages answer a question. It only picks: it gives their numbers,
 * the most relevant first, and the reader still reads only the text of the files. Mate sends this
 * itself, to the address the reader set; no agent is involved. Gives the passages' places in the list.
 */
export async function judgeOnEndpoint(question: string, passages: { title: string; text: string }[]): Promise<number[]> {
  if (!stored) throw new Error('Set your endpoint first, in the Agent tab of a private context.')
  // ponytail: a passage is cut at 1,200 characters, so thirty fit any model with a window of 16,000 tokens.
  const listed = passages.map((each, at) => `[${at + 1}] ${each.title}\n${each.text.slice(0, 1200)}`).join('\n\n')
  let answer: Response
  try {
    answer = await fetch(`${stored.url}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...keyHeader() },
      body: JSON.stringify({
        model: stored.model,
        temperature: 0,
        // Room for a model that thinks before it answers, and asked not to: `/no_think` is Qwen's switch.
        // Another model reads it as two words and goes on.
        max_tokens: 2000,
        messages: [
          { role: 'system', content: JUDGE },
          { role: 'user', content: `Text: ${question}\n\nPassages:\n\n${listed}\n\n/no_think` }
        ]
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(120_000)
    })
  } catch {
    throw new Error(`Your endpoint, ${new URL(stored.url).host}, could not be reached.`)
  }
  if (!answer.ok) throw new Error(`Your endpoint, ${new URL(stored.url).host}, answered ${answer.status}.`)
  const body = (await answer.json().catch(() => null)) as { choices?: { message?: { content?: unknown }; finish_reason?: unknown }[] } | null
  const choice = body?.choices?.[0]
  const content = String(choice?.message?.content ?? '')
  try {
    return picked(content, passages.length)
  } catch (failed) {
    // What came back, so the reader can tell a model that ran out of room from one that said something else.
    const said = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
    if (choice?.finish_reason === 'length') throw new Error(`${(failed as Error).message} It ran out of room before it answered.`)
    throw new Error(`${(failed as Error).message} ${said ? `It said: “${said.slice(0, 160)}${said.length > 160 ? '…' : ''}”` : 'Its answer was empty.'}`)
  }
}

/** The numbers a model gave, as places in the list: in its order, each once, none that is not there. */
export function picked(content: string, count: number): number[] {
  // A model that thinks aloud does it first, between these tags. The answer is the last such object after it:
  // prose or an example before it may hold braces of its own.
  const found = content.replace(/<think>[\s\S]*?<\/think>/g, '').match(/\{\s*"relevant"\s*:\s*\[[^\]]*\]\s*\}/g) ?? []
  let numbers: unknown
  try {
    numbers = (JSON.parse(found.at(-1) ?? '') as { relevant?: unknown }).relevant
  } catch {
    numbers = null
  }
  if (!Array.isArray(numbers)) throw new Error('Your endpoint did not answer in the form it was asked for.')
  return [...new Set(numbers.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= count))].map((n) => n - 1)
}
