import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { addComment, createDraft, placeOnDisk, readProject, resolveInside, writeDraft } from '../src/main/context.ts'
import { addReply, anchorComment, applySuggestion, combine, insertComment, parseComments, readDocument, retype, separate } from '../src/shared/comments.ts'

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

test('typing in a draft keeps every comment, and every line that was not touched', () => {
  const marker = (id: string, anchor: string) => `<!-- @comment{"id":"${id}","anchor":"${anchor}","text":"Why.","author":"ada"} -->`
  const file = ['# Title', '', 'First line.', marker('1', 'First line.'), 'Second line.', '', 'Third line.', marker('2', 'Third'), ''].join('\n')
  const shown = readDocument(file).text
  assert.equal(shown, '# Title\n\nFirst line.\nSecond line.\n\nThird line.\n')

  // Nothing typed: the file is the same, byte for byte.
  assert.equal(retype(file, shown), file)

  // A commented line is changed, and a paragraph is added far from it. Each marker is still under its line.
  const typed = retype(file, '# Title\n\nFirst line, edited.\nSecond line.\n\nA new paragraph.\n\nThird line.\n')
  assert.equal(typed, ['# Title', '', 'First line, edited.', marker('1', 'First line.'), 'Second line.', '', 'A new paragraph.', '', 'Third line.', marker('2', 'Third'), ''].join('\n'))
  const after = readDocument(typed)
  assert.equal(after.text, '# Title\n\nFirst line, edited.\nSecond line.\n\nA new paragraph.\n\nThird line.\n')
  // The first comment quotes words that are gone: it is kept, and shown as unanchored. The second is where it was.
  assert.deepEqual(after.comments.map((each) => [each.id, each.start === null]), [['1', true], ['2', false]])

  // A commented line is taken out. Its comment stays in the file.
  const cut = retype(file, '# Title\n\nSecond line.\n\nThird line.\n')
  assert.deepEqual(parseComments(cut).map((each) => each.id), ['1', '2'])
  assert.equal(readDocument(cut).text, '# Title\n\nSecond line.\n\nThird line.\n')

  // Windows line endings: a typed line takes the ending the file uses, and no other line changes.
  const windows = `One.\r\n${marker('1', 'One.')}\r\nTwo.\r\n`
  assert.equal(retype(windows, 'One.\nBetween.\nTwo.\n'), `One.\r\n${marker('1', 'One.')}\r\nBetween.\r\nTwo.\r\n`)

  // An empty line after the changed one keeps its Windows ending too.
  assert.equal(retype('One.\r\n\r\nTwo.\r\n', 'One, edited.\n\nTwo.\n'), 'One, edited.\r\n\r\nTwo.\r\n')
  assert.equal(retype('\r\nOne.\r\n', '\nOne, edited.\n'), '\r\nOne, edited.\r\n')

  // A file with no line break at its end keeps none, unless the reader types one.
  assert.equal(retype('One.\nTwo.', 'One.\nTwo, edited.'), 'One.\nTwo, edited.')
  assert.equal(retype('One.\nTwo.', 'One.\nTwo.\n'), 'One.\nTwo.\n')
  assert.equal(retype('', 'A first line.\n'), 'A first line.\n')
  // A marker that md-redline wrote inside a line goes with the line when it is kept, and survives when it is not.
  const inline = `${marker('1', 'Quoted')}Quoted words.\nNext.\n`
  assert.equal(retype(inline, readDocument(inline).text), inline)
  assert.deepEqual(parseComments(retype(inline, 'Other words.\nNext.\n')).map((each) => each.id), ['1'])
})

test('a draft is saved from what the reader began with, and a new draft never writes over a file', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-'))
  try {
    const draft = path.join(root, 'projects', 'review', 'draft')
    await mkdir(draft, { recursive: true })
    await writeFile(path.join(draft, 'document.md'), 'The current sentence.\n')
    const opened = await readProject(root, 'review')
    const saved = await writeDraft(root, 'review', 'document.md', opened.text, 'The current sentence.\nAnd one more.\n')
    assert.equal(saved.text, 'The current sentence.\nAnd one more.\n')
    assert.equal(await readFile(path.join(draft, 'document.md'), 'utf8'), 'The current sentence.\nAnd one more.\n')

    // Someone else wrote the file meanwhile. What the reader typed on the old text is not saved over it.
    await writeFile(path.join(draft, 'document.md'), 'Written by an agent.\n')
    await assert.rejects(writeDraft(root, 'review', 'document.md', saved.text, 'Mine.\n'), /has changed since you began/)
    assert.equal(await readFile(path.join(draft, 'document.md'), 'utf8'), 'Written by an agent.\n')
    await assert.rejects(writeDraft(root, 'review', '../intents.md', '', 'x'), /not in this project/)

    const made = await createDraft(root, 'review', 'Second thoughts')
    assert.deepEqual([made.file, made.text, made.drafts], ['Second thoughts.md', '# Second thoughts\n', ['Second thoughts.md', 'document.md']])
    await assert.rejects(createDraft(root, 'review', 'Second thoughts.md'), /already there/)
    for (const name of ['', '.hidden', '../up', 'a/b']) await assert.rejects(createDraft(root, 'review', name), /Name the draft/)
    await assert.rejects(createDraft(root, 'nowhere', 'x'), /not in this context/)
    // A project with no draft folder gets one with its first draft.
    await mkdir(path.join(root, 'projects', 'empty'))
    assert.equal((await createDraft(root, 'empty', 'first')).file, 'first.md')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a file that is not markdown keeps its comments beside it, and is given back to the byte', () => {
  const xml = '<Sysmon schemaversion="4.90">\r\n  <EventFiltering>\r\n    <ProcessCreate onmatch="exclude"/>\r\n  </EventFiltering>\r\n</Sysmon>'
  // No comments yet: the two together are the file.
  assert.equal(combine(xml, ''), xml)
  const commented = insertComment(combine(xml, ''), '<ProcessCreate onmatch="exclude"/>', 'Why exclude everything?', 'you')
  const { body, side } = separate(commented, 'sysmon.xml')
  // The file is as it was, to the byte: its Windows line endings, and its last line without one.
  assert.equal(body, xml)
  assert.match(side, /^# Comments on sysmon\.xml\n\n.*\n\n<!-- @comment\{.*"line":3.*\} -->\n$/)
  // Put together again, the comment is under its line and finds its quote.
  const again = readDocument(combine(xml, side))
  assert.equal(again.text, xml.replace(/\r\n/g, '\n'))
  assert.equal(again.comments[0].text, 'Why exclude everything?')
  assert.equal(again.comments[0].start, again.text.indexOf('<ProcessCreate'))
  // A line that is gone puts the marker at the end, and the quote still finds its place.
  const moved = readDocument(combine('<Sysmon>\n    <ProcessCreate onmatch="exclude"/>\n</Sysmon>\n', side))
  assert.equal(moved.comments[0].start, moved.text.indexOf('<ProcessCreate'))
})
