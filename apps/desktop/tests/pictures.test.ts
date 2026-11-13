import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { AGENTS } from '../src/main/agents.ts'
import { copyPicture } from '../src/main/context.ts'

async function context(): Promise<{ root: string; source: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-pictures-'))
  await mkdir(path.join(root, 'projects', 'demo'), { recursive: true })
  const outside = await mkdtemp(path.join(tmpdir(), 'mate-pictures-outside-'))
  const source = path.join(outside, 'cat.png')
  await writeFile(source, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  return { root, source }
}

test('a picture the reader chooses is copied into the dropbox, and the original stays', async () => {
  const { root, source } = await context()
  const first = await copyPicture(root, 'demo', source)
  assert.equal(first, 'projects/demo/dropbox/cat.png')
  assert.deepEqual(await readFile(path.join(root, first)), await readFile(source))
  // A second picture of the same name is not written over.
  assert.equal(await copyPicture(root, 'demo', source), 'projects/demo/dropbox/cat-2.png')
})

test('only a picture is copied in; a file of another kind is refused', async () => {
  const { root, source } = await context()
  const text = source.replace(/cat\.png$/, 'notes.txt')
  await writeFile(text, 'not a picture')
  await assert.rejects(copyPicture(root, 'demo', text), /PNG, JPEG, GIF or WebP/)
  await assert.rejects(copyPicture(root, 'demo', 'cat.png'), /PNG, JPEG, GIF or WebP/)
})

test('Hermes is given the picture on its command line, and only when there is one', () => {
  const turn = { cwd: '/c/projects/demo', contextDir: '/c', resume: null, mayWrite: false }
  const with_ = AGENTS.hermes.args({ ...turn, picture: '/c/projects/demo/dropbox/cat.png' })
  const at = with_.indexOf('--image')
  assert.ok(at > 0)
  assert.equal(with_[at + 1], '/c/projects/demo/dropbox/cat.png')
  assert.equal(AGENTS.hermes.args(turn).includes('--image'), false)
  // The private endpoint starts Hermes the same way, so it gets the picture too.
  assert.equal(AGENTS.private.args({ ...turn, picture: '/c/projects/demo/dropbox/cat.png' }).includes('--image'), true)
})
