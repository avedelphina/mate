import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { keepRecentIn, moveRecent, recentContexts, rememberContext } from '../src/main/recent.ts'

test('the contexts opened last: newest first, once each, kept, renamed, and only those still there', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-recent-'))
  try {
    const [a, b, c] = ['a', 'b', 'c'].map((name) => path.join(root, name))
    for (const each of [a, b, c]) await mkdir(each)
    const file = path.join(root, 'recent.json')
    keepRecentIn(file)
    assert.deepEqual(recentContexts(), [])
    rememberContext(a)
    rememberContext(b)
    rememberContext(a)
    assert.deepEqual(recentContexts(), [a, b])
    // It is kept in the file, and read back from it.
    keepRecentIn(file)
    assert.deepEqual(recentContexts(), [a, b])
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), [a, b])
    // A renamed context keeps its place. A folder that is gone is not offered.
    moveRecent(b, c)
    assert.deepEqual(recentContexts(), [a, c])
    await rm(a, { recursive: true })
    assert.deepEqual(recentContexts(), [c])
    // A file that is not there holds nothing.
    keepRecentIn(path.join(root, 'missing.json'))
    assert.deepEqual(recentContexts(), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
