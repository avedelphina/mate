import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { checkEndpoint, endpointView, keepEndpointIn, profileConfig, sandboxProfile, setEndpoint, startRelay, stopRelay } from '../src/main/endpoint.ts'

// A stand-in for the keychain: anything but the key as it was given.
const seal = { encrypt: (text: string) => Buffer.from([...text].reverse().join('')), decrypt: (sealed: Buffer) => [...sealed.toString()].reverse().join('') }

/** A server on this computer that says what it was sent. */
async function listen(handler: http.RequestListener): Promise<{ port: number; close(): void }> {
  const server = http.createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { port: (server.address() as { port: number }).port, close: () => server.close() }
}

test('an endpoint is an https address, or one on this computer, and a model', () => {
  assert.equal(checkEndpoint('https://llm.example.org/v1', 'Qwen/Qwen3.6-35B-A3B-FP8').host, 'llm.example.org')
  assert.equal(checkEndpoint('http://127.0.0.1:8000/v1', 'm').port, '8000')
  assert.throws(() => checkEndpoint('http://llm.example.org/v1', 'm'), /must begin with https/)
  assert.throws(() => checkEndpoint('https://llm.example.org/v1?key=x', 'm'), /address alone/)
  assert.throws(() => checkEndpoint('https://user:pw@llm.example.org/v1', 'm'), /address alone/)
  assert.throws(() => checkEndpoint('https://llm.example.org/v1', '--version'), /name of the model/)
  assert.throws(() => checkEndpoint('not an address', 'm'), /not an address/)
})

test('the relay passes a request with its token to the endpoint, adds the key there, and nothing else gets through', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mate-endpoint-'))
  const seen: { url?: string; auth?: string; body?: string }[] = []
  const upstream = await listen((request, response) => {
    let body = ''
    request.on('data', (chunk) => (body += chunk))
    request.on('end', () => {
      seen.push({ url: request.url, auth: request.headers.authorization, body })
      response.writeHead(200, { 'content-type': 'text/event-stream' }).end('data: hello\n\n')
    })
  })
  try {
    keepEndpointIn(path.join(dir, 'endpoint.json'), seal)
    assert.equal(endpointView(), null)
    assert.equal(setEndpoint(`http://127.0.0.1:${upstream.port}/v1/`, 'qwen', 'secret-key'), true)
    assert.deepEqual(endpointView(), { url: `http://127.0.0.1:${upstream.port}/v1`, model: 'qwen', hasKey: true })
    // The key is kept sealed, never as it was typed.
    assert.equal((await readFile(path.join(dir, 'endpoint.json'), 'utf8')).includes('secret-key'), false)

    const { port, token } = await startRelay()
    const call = (url: string, headers: Record<string, string>) =>
      fetch(`http://127.0.0.1:${port}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{"messages":[]}' })
    assert.equal((await call('/v1/chat/completions', {})).status, 401)
    assert.equal((await call('/v1/chat/completions', { authorization: 'Bearer wrong' })).status, 401)
    assert.equal((await call('/v1/chat/completions', { authorization: `Bearer ${token}`, origin: 'https://example.org' })).status, 403)
    assert.equal(seen.length, 0)

    const answer = await call('/v1/chat/completions', { authorization: `Bearer ${token}` })
    assert.equal(answer.status, 200)
    assert.equal(await answer.text(), 'data: hello\n\n')
    assert.deepEqual(seen, [{ url: '/v1/chat/completions', auth: 'Bearer secret-key', body: '{"messages":[]}' }])

    // The same host keeps its key. A new host does not get the old one, and the contexts opened to the old host close.
    assert.equal(setEndpoint(`http://127.0.0.1:${upstream.port}/v1`, 'other'), false)
    assert.equal(endpointView()!.hasKey, true)
    assert.equal(setEndpoint('https://llm.example.org/v1', 'other'), true)
    assert.equal(endpointView()!.hasKey, false)
  } finally {
    stopRelay()
    upstream.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('in the sandbox, a program reaches the relay and no other address, even on this computer', { skip: process.platform !== 'darwin' }, async () => {
  const relay = await listen((_request, response) => response.end('relay'))
  const other = await listen((_request, response) => response.end('other'))
  try {
    const reach = (port: number) => `fetch('http://127.0.0.1:${port}').then((r) => r.text(), () => 'blocked')`
    const script = `Promise.all([${reach(relay.port)}, ${reach(other.port)}, fetch('https://example.org').then(() => 'out', () => 'blocked')]).then((all) => console.log(all.join(' ')))`
    // Not the synchronous form: the two servers are in this process, and must answer while it waits.
    const { stdout } = await promisify(execFile)('/usr/bin/sandbox-exec', ['-p', sandboxProfile(relay.port), process.execPath, '-e', script], { timeout: 30_000 })
    assert.equal(stdout.trim(), 'relay blocked blocked')
  } finally {
    relay.close()
    other.close()
  }
})

test("Mate's Hermes profile has the relay as its only way out", () => {
  const config = profileConfig(4242, 'token-for-the-relay', 'Qwen/Qwen3.6-35B-A3B-FP8')
  assert.match(config, /provider: custom:mate-relay\n/)
  assert.match(config, /api: http:\/\/127\.0\.0\.1:4242\/v1\n/)
  assert.match(config, /fallback_providers: \[\]\n/)
  assert.match(config, /toolsets:\n {2}- file\n/)
  assert.match(config, /plugins:\n {2}enabled: \[\]\n/)
  assert.equal(/https?:\/\/(?!127\.0\.0\.1)/.test(config), false)
})
