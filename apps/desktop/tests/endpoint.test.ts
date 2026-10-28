import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { checkEndpoint, endpointView, judgeOnEndpoint, keepEndpointIn, linuxRelay, linuxSandbox, picked, profileConfig, sandboxProfile, setEndpoint, startRelay, stopRelay } from '../src/main/endpoint.ts'

// A stand-in for the keychain: anything but the key as it was given.
const seal = { encrypt: (text: string) => Buffer.from([...text].reverse().join('')), decrypt: (sealed: Buffer) => [...sealed.toString()].reverse().join('') }

const available = (command: string): boolean => {
  try {
    execFileSync(command, ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

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

test('in the Linux sandbox, a program reaches only Mate through the Unix-socket bridge', { skip: process.platform !== 'linux' || !available('bwrap') || !available('python3') }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mate-linux-endpoint-'))
  const upstream = await listen((_request, response) => response.end('relay'))
  const other = await listen((_request, response) => response.end('other'))
  // A Unix socket on the host, as the D-Bus bus or an ssh connection is: no network, and still a way out.
  const outside = path.join(dir, 'outside.sock')
  const host = net.createServer((client) => client.end('open'))
  await new Promise<void>((resolve) => host.listen(outside, resolve))
  // The one folder the sandbox may write to, as the context is. The checkout is seen, and only read.
  const writable = await mkdtemp(path.join(tmpdir(), 'mate-linux-writable-'))
  const probe = path.join(process.cwd(), '.sandbox-probe')
  try {
    keepEndpointIn(path.join(dir, 'endpoint.json'), seal)
    setEndpoint(`http://127.0.0.1:${upstream.port}/v1`, 'qwen')
    const { socket, token } = await startRelay()
    const script = `
import urllib.request
def reach(url, data=None, headers={}):
    try:
        request = urllib.request.Request(url, data=data, headers=headers)
        return urllib.request.urlopen(request, timeout=4).read().decode()
    except Exception:
        return 'blocked'
relay = reach('http://127.0.0.1:${linuxRelay.port}/v1/chat/completions', b'{}', {'Authorization': 'Bearer ${token}', 'Content-Type': 'application/json'})
other = reach('http://127.0.0.1:${other.port}')
outside = reach('https://example.org')
import socket
def unix(path):
    try:
        s = socket.socket(socket.AF_UNIX)
        s.settimeout(3)
        s.connect(path)
        return 'open'
    except Exception:
        return 'blocked'
def write(path):
    try:
        open(path, 'w').write('x')
        return 'written'
    except Exception:
        return 'blocked'
print(relay, other, outside, unix('${outside}'), write('${path.join(writable, 'note.txt')}'), write('${probe}'))
`
    const args = [...linuxSandbox(socket, [writable]), 'python3', '-c', script]
    const { stdout } = await promisify(execFile)(args[0], args.slice(1), { timeout: 30_000 })
    assert.equal(stdout.trim(), 'relay blocked blocked blocked written blocked')
  } finally {
    stopRelay()
    upstream.close()
    other.close()
    host.close()
    await rm(probe, { force: true })
    await rm(dir, { recursive: true, force: true })
    await rm(writable, { recursive: true, force: true })
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

test("the endpoint's pick is read in its order, each once, and only of passages that are there", () => {
  assert.deepEqual(picked('{"relevant": [3, 1]}', 3), [2, 0])
  assert.deepEqual(picked('<think>Passage 2 is about kitchens. {"relevant": [9]}</think>\nHere: {"relevant": [2, 2, 7, 0, "1"]}', 3), [1, 0])
  assert.deepEqual(picked('{"relevant": []}', 3), [])
  assert.deepEqual(picked('For example {"relevant": [1, 2]} would mean two.\n```json\n{"relevant": [3]}\n```', 3), [2])
  assert.throws(() => picked('Passages 1 and 2 answer it.', 3), /did not answer in the form/)
  assert.throws(() => picked('{"relevant": "1"}', 3), /did not answer in the form/)
})

test('the endpoint is asked only to pick, with the key, and its pick comes back as places in the list', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mate-judge-'))
  let sent: { auth?: string; body?: Record<string, any> } = {} // eslint-disable-line @typescript-eslint/no-explicit-any
  const upstream = await listen((request, response) => {
    let body = ''
    request.on('data', (chunk) => (body += chunk))
    request.on('end', () => {
      sent = { auth: request.headers.authorization, body: JSON.parse(body) }
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: '{"relevant": [2]}' } }] }))
    })
  })
  try {
    keepEndpointIn(path.join(dir, 'endpoint.json'), seal)
    setEndpoint(`http://127.0.0.1:${upstream.port}/v1`, 'qwen', 'secret-key')
    const order = await judgeOnEndpoint('Can we send our budget to an agency?', [
      { title: 'Kitchen', text: 'The kitchen is cleaned on Fridays.' },
      { title: 'Suppliers', text: 'Confidential data goes to a supplier only under an NDA.' }
    ])
    assert.deepEqual(order, [1])
    assert.equal(sent.auth, 'Bearer secret-key')
    assert.equal(sent.body!.model, 'qwen')
    assert.equal(sent.body!.temperature, 0)
    assert.match(sent.body!.messages[0].content, /You do not answer it/)
    assert.match(sent.body!.messages[1].content, /^Text: Can we send our budget to an agency\?\n\nPassages:\n\n\[1\] Kitchen\n.*\n\n\[2\] Suppliers\n/)
  } finally {
    upstream.close()
    await rm(dir, { recursive: true, force: true })
  }
})
