import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  assistRequest,
  checkNativeAssist,
  checkOllamaAssist,
  runNativeAssist,
  runOllamaAssist
} from '../src/main/assist.ts'

/** A stand-in for the native helper: it answers every question with the same line. */
async function helper(dir: string, name: string, check: string, answer: string): Promise<string> {
  const file = path.join(dir, name)
  await writeFile(file, `#!/bin/sh\nif [ "$1" = "--check" ]; then echo '${check}'; else cat > /dev/null; echo '${answer}'; fi\n`)
  await chmod(file, 0o755)
  return file
}

test('the question carries the passage, and the reviewer note when there is one', () => {
  const rewrite = assistRequest('rewrite', 'The shelf is current.', ' Make it shorter. ')
  assert.equal(rewrite.prompt, 'The shelf is current.')
  assert.match(rewrite.instructions, /Make it shorter\./)
  assert.doesNotMatch(assistRequest('rewrite', 'The shelf is current.', '').instructions, /reviewer/)
  assert.match(assistRequest('note', 'The shelf is current.', '').instructions, /unclear, missing/)
})

test('the native assist is offered only where the helper is, and answers with plain text', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mate-assist-'))
  try {
    assert.deepEqual(await checkNativeAssist(path.join(dir, 'absent')), { present: false, available: false, reason: '' })

    const ready = await helper(dir, 'ready', '{"available":true}', '{"text":" \\"The shelf holds what is true.\\" "}')
    assert.deepEqual(await checkNativeAssist(ready), { present: true, available: true, reason: '' })
    assert.equal(await runNativeAssist(ready, 'rewrite', 'The shelf is current.', ''), 'The shelf holds what is true.')
    await assert.rejects(runNativeAssist(ready, 'rewrite', '  ', ''), /Select a passage/)

    const waiting = await helper(dir, 'waiting', '{"available":false,"reason":"Still downloading."}', '{"error":"Still downloading."}')
    assert.deepEqual(await checkNativeAssist(waiting), { present: true, available: false, reason: 'Still downloading.' })
    await assert.rejects(runNativeAssist(waiting, 'note', 'The shelf is current.', ''), /Still downloading/)

    const broken = await helper(dir, 'broken', 'not json', 'not json')
    assert.equal((await checkNativeAssist(broken)).available, false)
    await assert.rejects(runNativeAssist(broken, 'note', 'The shelf is current.', ''), /could not be read/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Ollama offers the assist when the model is there and answers the same question', async () => {
  let chat: { model?: string; stream?: boolean; messages?: { role: string; content: string }[] } = {}
  const server = createServer(async (request, response) => {
    if (request.url === '/api/tags') {
      response.end(JSON.stringify({ models: [{ name: 'test:model' }] }))
      return
    }
    let body = ''
    for await (const chunk of request) body += chunk
    chat = JSON.parse(body)
    response.end(JSON.stringify({ message: { content: ' “A clearer passage.” ' } }))
  })
  server.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('The Ollama stand-in has no port.')
  const url = `http://127.0.0.1:${address.port}`
  try {
    assert.deepEqual(await checkOllamaAssist(url, 'test:model'), { present: true, available: true, reason: '' })
    const missing = await checkOllamaAssist(url, 'other:model')
    assert.equal(missing.available, false)
    assert.match(missing.reason, /ollama pull other:model/)
    assert.equal(await runOllamaAssist('rewrite', 'The original passage.', 'Make it shorter.', url, 'test:model'), 'A clearer passage.')
    assert.equal(chat.model, 'test:model')
    assert.equal(chat.stream, false)
    assert.match(chat.messages?.[0]?.content ?? '', /Make it shorter/)
    assert.equal(chat.messages?.[1]?.content, 'The original passage.')
    await assert.rejects(runOllamaAssist('rewrite', ' ', '', url, 'test:model'), /Select a passage/)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
