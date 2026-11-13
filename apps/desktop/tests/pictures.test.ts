import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { AGENTS } from '../src/main/agents.ts'
import { copyFile, copyPicture, intoDropbox, readPicture } from '../src/main/context.ts'
import { attachmentsOn } from '../src/main/sessions.ts'

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

test('a markdown picture is read only from inside the context and only in supported formats', async () => {
  const { root } = await context()
  const picture = path.join(root, 'projects', 'demo', 'image.png')
  await writeFile(picture, Buffer.from([1, 2, 3]))
  assert.deepEqual(await readPicture(root, 'projects/demo/image.png'), { mimeType: 'image/png', data: Buffer.from([1, 2, 3]).toString('base64') })
  await assert.rejects(readPicture(root, '../outside.png'), /not a picture/)
  await assert.rejects(readPicture(root, 'projects/demo/../image.png'), /not a picture/)
  const notes = path.join(root, 'projects', 'demo', 'notes.txt')
  await writeFile(notes, 'not an image')
  await assert.rejects(readPicture(root, 'projects/demo/notes.txt'), /PNG, JPEG, GIF or WebP/)
  const large = path.join(root, 'projects', 'demo', 'large.png')
  await writeFile(large, Buffer.alloc(10 * 1024 * 1024 + 1))
  await assert.rejects(readPicture(root, 'projects/demo/large.png'), /larger than 10 MB/)
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

test('a text or PDF file the reader chooses is copied into the dropbox, and other kinds are refused', async () => {
  const { root, source } = await context()
  const note = source.replace(/cat\.png$/, 'notes.md')
  await writeFile(note, '# Notes\n')
  assert.equal(await copyFile(root, 'demo', note), 'projects/demo/dropbox/notes.md')
  const pdf = source.replace(/cat\.png$/, 'brief.pdf')
  await writeFile(pdf, '%PDF-1.4\n')
  assert.equal(await copyFile(root, 'demo', pdf), 'projects/demo/dropbox/brief.pdf')
  // A picture is not a file of this kind, and nor is a program.
  await assert.rejects(copyFile(root, 'demo', source), /Markdown, text, CSV or PDF/)
  const program = source.replace(/cat\.png$/, 'tool.exe')
  await writeFile(program, 'MZ')
  await assert.rejects(copyFile(root, 'demo', program), /Markdown, text, CSV or PDF/)
})

test('a pasted picture is written into the dropbox under its own name, never over one there', async () => {
  const { root } = await context()
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
  assert.equal(await intoDropbox(root, 'demo', 'pasted-1.png', png), 'projects/demo/dropbox/pasted-1.png')
  assert.equal(await intoDropbox(root, 'demo', 'pasted-1.png', png), 'projects/demo/dropbox/pasted-1-2.png')
})

test('an attachment must be a file of the project dropbox, at most five, and one picture', async () => {
  const { root, source } = await context()
  const note = source.replace(/cat\.png$/, 'notes.md')
  await writeFile(note, '# Notes\n')
  const picture = await copyPicture(root, 'demo', source)
  const file = await copyFile(root, 'demo', note)
  const both = await attachmentsOn(root, 'demo', [file, picture])
  assert.equal(both.picture?.relative, picture)
  assert.deepEqual(both.files, [file])
  // Two pictures are one too many: Hermes is given one.
  await assert.rejects(attachmentsOn(root, 'demo', [picture, picture.replace('cat', 'cat-2')]), /One picture at a time/)
  // A file of the context outside the dropbox, or a way out of it, is refused.
  await writeFile(path.join(root, 'projects', 'demo', 'outside.md'), '# Outside\n')
  await assert.rejects(attachmentsOn(root, 'demo', ['projects/demo/outside.md']), /not a file of this project's dropbox/)
  await assert.rejects(attachmentsOn(root, 'demo', ['projects/demo/dropbox/../outside.md']), /not a file of this project's dropbox/)
  // Five things at most.
  await assert.rejects(attachmentsOn(root, 'demo', [file, file, file, file, file, file]), /at most 5/)
})
