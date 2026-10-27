import { execFile } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { isModel } from './agents'

/**
 * The reader's own inference endpoint, for a private context that may use one. Hermes is the agent,
 * but it never reaches the endpoint itself:
 *
 * - It runs in the macOS sandbox with no network but one port on this computer: Mate's relay.
 * - The relay forwards to the endpoint the reader set, and to nothing else, and adds the key there.
 *   Hermes holds only a token for the relay, good while the app runs.
 * - It runs under a Hermes profile of Mate's own, `mate-private`, with no fallback providers, no
 *   plugins, no memory and file tools only. The reader's own profile may fall back to the cloud.
 *
 * The sandbox cannot allow one remote host, only this computer or every host, so the relay is what
 * names the endpoint. Whatever the profile says, nothing else is reachable.
 */

/** Encrypts the key at rest. Electron's safeStorage in the app (the macOS keychain), a stand-in in the tests. */
export type Seal = { encrypt(text: string): Buffer; decrypt(sealed: Buffer): string }

type Stored = { url: string; model: string; key?: string }

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

let relay: { port: number; token: string; close(): void } | null = null

/** The relay, started on first use. Every request needs its token, and none may come from a web page. */
export async function startRelay(): Promise<{ port: number; token: string }> {
  if (relay) return relay
  const token = randomBytes(24).toString('hex')
  const expected = Buffer.from(`Bearer ${token}`)
  const server = http.createServer(async (request, response) => {
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
          ...(stored.key ? { authorization: `Bearer ${seal!.decrypt(Buffer.from(stored.key, 'base64'))}` } : {})
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
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  relay = { port, token, close: () => server.close() }
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

/** Before a private turn: the relay runs, and the profile names it. Gives the relay's port for the sandbox. */
export async function preparePrivate(env: NodeJS.ProcessEnv): Promise<number> {
  if (!stored) throw new Error('Set your endpoint first, in the Agent tab.')
  const { port, token } = await startRelay()
  const dir = profileDir()
  // Hermes makes a profile with its own command. It copies the reader's config, which is written over at once.
  if (!existsSync(dir)) {
    await new Promise<void>((resolve, reject) =>
      execFile('hermes', ['profile', 'create', PROFILE, '--no-alias', '--no-skills'], { env, timeout: 60_000 }, (failed) => (failed ? reject(failed) : resolve()))
    )
  }
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'config.yaml'), profileConfig(port, token, stored.model), { mode: 0o600 })
  return port
}
