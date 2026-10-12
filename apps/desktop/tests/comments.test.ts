import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { addComment, readProject, resolveInside } from '../src/main/context.ts'
import { insertComment, parseComments, readDocument } from '../src/shared/comments.ts'

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

test('the anchor must be in the document, and the note must say something', () => {
  assert.throws(() => insertComment('Alpha\n', '', 'note', 'ada'), /sentence/i)
  assert.throws(() => insertComment('Alpha\n', 'Alpha', '  ', 'ada'), /empty/i)
  assert.throws(() => insertComment('Alpha\n', 'Missing', 'note', 'ada'), /not in this document/i)
})

test('a comment leaves every line ending as the file had it', () => {
  const windows = 'Alpha stays.\r\nBeta changes.\r\nGamma stays.\r\n'
  const next = insertComment(windows, 'Beta changes.', 'Say why.', 'ada')
  assert.equal(next.replace(/\r\n/g, '').includes('\n'), false)
  assert.equal(next.split('\r\n').length, 5)
  assert.match(next.split('\r\n')[2], /^<!-- @comment/)
  assert.equal(insertComment('No newline at the end', 'newline', 'Why.', 'ada').endsWith('-->'), true)
})

test('a passage may run over lines, and is commented where it was selected', () => {
  const draft = 'The shelf\r\nis current.\r\nThe shelf\r\nis a proposal.\r\n'
  const first = insertComment(draft, 'The shelf\nis', 'Which one?', 'ada')
  assert.match(first.split('\r\n')[2], /@comment/)
  // The marker is not part of the text the reader selects from.
  assert.equal(readDocument(first).text, 'The shelf\nis current.\nThe shelf\nis a proposal.\n')
  const second = insertComment(first, 'The shelf\nis', 'And this one?', 'ada', 21)
  assert.match(second.split('\r\n')[5], /And this one/)
  assert.deepEqual(parseComments(second).map((comment) => comment.id), ['1', '2'])
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

    // A second draft: the project lists both and opens neither until one is named.
    await writeFile(path.join(draft, 'appendix.md'), 'Another draft.\n')
    const listed = await readProject(root, 'review')
    assert.deepEqual(listed.drafts, ['appendix.md', 'document.md'])
    assert.equal(listed.file, null)
    assert.equal((await readProject(root, 'review', 'document.md')).file, 'document.md')
    await assert.rejects(readProject(root, 'review', '../intents.md'), /not in this project/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
