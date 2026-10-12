import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { addComment, placeOnDisk, readProject, resolveInside } from '../src/main/context.ts'
import {
  addReply,
  anchorComment,
  applySuggestion,
  insertComment,
  parseComments,
  readDocument
} from '../src/shared/comments.ts'

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

test('a thread keeps its replies and what another tool stored in the marker', () => {
  const redline =
    'Alpha stays.\n<!-- @comment{"id":"7","anchor":"Alpha stays.","text":"Why?","author":"pm","timestamp":"2026-03-19T10:00:00Z"} -->\n'
  const next = addReply(redline, '7', 'Because --> it does.', 'ada')
  assert.deepEqual(parseComments(next)[0].replies, [{ text: 'Because --> it does.', author: 'ada' }])
  assert.match(next, /"timestamp":"2026-03-19T10:00:00Z"/)
  // The reply cannot close the HTML comment early.
  assert.equal(next.match(/-->/g)?.length, 1)
  assert.throws(() => addReply(next, '8', 'Reply.', 'ada'), /no longer in the file/)
})

test('a suggestion changes the file only when it is applied', () => {
  const draft = 'Alpha stays.\r\nBeta is\r\nwrong here.\r\nGamma stays.\r\n'
  const inner = insertComment(draft, 'Beta is', 'Another comment.', 'ada')
  const suggested = insertComment(inner, 'Beta is\nwrong here.', '', 'ada', 0, 'Beta holds.')
  assert.equal(readDocument(suggested).text, readDocument(draft).text)

  const applied = applySuggestion(suggested, '2')
  assert.equal(readDocument(applied).text, 'Alpha stays.\nBeta holds.\nGamma stays.\n')
  assert.equal(applied.replace(/\r\n/g, '').includes('\n'), false)
  // The comment caught inside the replaced passage is kept. Its quote is gone, so it is unanchored.
  const [caught, done] = readDocument(applied).comments
  assert.equal(caught.text, 'Another comment.')
  assert.equal(caught.start, null)
  assert.equal(done.resolved, true)
  assert.throws(() => applySuggestion(applied, '2'), /already applied/)
  assert.throws(() => applySuggestion(applied, '1'), /suggests no replacement/)
})

test('a comment whose quote is gone is kept, and anchored again only by hand', () => {
  const draft = insertComment('Alpha stays.\nBeta changes.\n', 'Beta changes.', '', 'ada', 0, 'Beta changed.')
  const edited = draft.replace('Beta changes.\n', 'Beta was rewritten.\n')
  assert.equal(readDocument(edited).comments[0].start, null)
  assert.throws(() => applySuggestion(edited, '1'), /no longer in the file/)

  const anchored = anchorComment(edited, '1', 'Alpha stays.')
  assert.equal(readDocument(anchored).comments[0].start, 0)
  assert.match(anchored.split('\n')[1], /@comment/)
  assert.equal(anchored.split('\n').length, edited.split('\n').length)
})

test('the quote next to the marker wins over the same words elsewhere', () => {
  const twice = 'The shelf is current.\nThe shelf is current.\n'
  const second = insertComment(twice, 'The shelf is current.', 'This one.', 'ada', 5)
  assert.equal(readDocument(second).comments[0].start, 22)
  // md-redline writes its marker just before the passage.
  const inline =
    'The shelf. <!-- @comment{"id":"a","anchor":"The shelf","text":"Which?","author":"pm"} -->The shelf is current.\n'
  assert.equal(readDocument(inline).comments[0].start, 11)
  assert.throws(() => insertComment('the cat and the dog\n', 'the', 'Which?', 'ada'), /more than once on that line/)
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

test('any file of the context can be shown where it lies, and nothing hidden or outside it', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-'))
  try {
    await mkdir(path.join(root, 'projects/review/timesheets'), { recursive: true })
    await mkdir(path.join(root, '.sessions'))
    await writeFile(path.join(root, 'projects/review/timesheets/october.xlsx'), 'not markdown')
    await writeFile(path.join(root, '.sessions/secret'), 'hidden')
    await writeFile(`${root}-outside.txt`, 'outside')
    await symlink(`${root}-outside.txt`, path.join(root, 'projects/review/leak.txt'))

    assert.equal(await placeOnDisk(root, 'projects/review/timesheets/october.xlsx'), path.join(await realpath(root), 'projects/review/timesheets/october.xlsx'))
    await assert.rejects(placeOnDisk(root, '.sessions/secret'), /not a file of this context/)
    await assert.rejects(placeOnDisk(root, '../outside.txt'), /not a file of this context/)
    await assert.rejects(placeOnDisk(root, 'projects/review/leak.txt'), /leaves the context/)
    await assert.rejects(placeOnDisk(root, 'projects/review/missing.pdf'))
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(`${root}-outside.txt`, { force: true })
  }
})
