import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { addComment, readProject, resolveInside } from '../src/main/context.ts'
import { insertComment, parseComments } from '../src/shared/comments.ts'

test('a comment is written on the line after the sentence it quotes', () => {
  const next = insertComment('Alpha stays.\nBeta changes.\n', 'Beta changes.', 'Say why.', 'ada')
  const comments = parseComments(next)
  assert.equal(comments.length, 1)
  assert.equal(comments[0].id, '1')
  assert.equal(comments[0].anchor, 'Beta changes.')
  assert.match(next.split('\n')[2], /@comment/)
})

test('a second comment gets the next id and a broken marker is ignored', () => {
  const first = insertComment('Alpha stays.\n', 'Alpha stays.', 'One.', 'ada')
  const broken = first + '\n<!-- @comment{not json} -->\n'
  const second = insertComment(broken, 'Alpha stays.', 'Two.', 'ada')
  const comments = parseComments(second)
  assert.deepEqual(comments.map((comment) => comment.id), ['1', '2'])
})

test('the anchor must be one real line, and the note must say something', () => {
  assert.throws(() => insertComment('Alpha\n', '', 'note', 'ada'), /sentence/i)
  assert.throws(() => insertComment('Alpha\n', 'Alpha', '  ', 'ada'), /empty/i)
  assert.throws(() => insertComment('Alpha\n', 'Missing', 'note', 'ada'), /not on a single line/i)
})

test('a project draft round-trips through the folder and cannot climb out', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-'))
  try {
    const draft = path.join(root, 'projects', 'review', 'draft')
    await mkdir(draft, { recursive: true })
    await writeFile(path.join(draft, 'document.md'), 'The current sentence.\n')
    await writeFile(path.join(root, 'projects', 'review', 'intents.md'), 'Stay honest.\n')
    const opened = await readProject(root, 'review')
    assert.equal(opened.file, 'document.md')
    assert.equal(opened.intents, 'Stay honest.\n')
    const saved = await addComment(root, 'review', 'document.md', 'The current sentence.', 'Needs a source.', 'ada')
    assert.equal(saved.comments[0].text, 'Needs a source.')
    const onDisk = await readFile(path.join(draft, 'document.md'), 'utf8')
    assert.match(onDisk, /Needs a source/)
    assert.throws(() => resolveInside(root, '..', 'outside.md'), /leaves the context/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
