import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { assistRequest, checkAssist, runAssist } from '../src/main/assist.ts'

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

test('the assist is offered only where the helper is, and answers with plain text', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mate-assist-'))
  try {
    assert.deepEqual(await checkAssist(path.join(dir, 'absent')), { present: false, available: false, reason: '' })

    const ready = await helper(dir, 'ready', '{"available":true}', '{"text":" \\"The shelf holds what is true.\\" "}')
    assert.deepEqual(await checkAssist(ready), { present: true, available: true, reason: '' })
    assert.equal(await runAssist(ready, 'rewrite', 'The shelf is current.', ''), 'The shelf holds what is true.')
    await assert.rejects(runAssist(ready, 'rewrite', '  ', ''), /Select a passage/)

    const waiting = await helper(dir, 'waiting', '{"available":false,"reason":"Still downloading."}', '{"error":"Still downloading."}')
    assert.deepEqual(await checkAssist(waiting), { present: true, available: false, reason: 'Still downloading.' })
    await assert.rejects(runAssist(waiting, 'note', 'The shelf is current.', ''), /Still downloading/)

    const broken = await helper(dir, 'broken', 'not json', 'not json')
    assert.equal((await checkAssist(broken)).available, false)
    await assert.rejects(runAssist(broken, 'note', 'The shelf is current.', ''), /could not be read/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
