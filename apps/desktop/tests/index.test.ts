import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { addComment, createContext, createDraft, createProject, describeContext, importProject, listProjects, makeFolder, moveEntry, readNote, readProject, renameContext, renameProject, sendToProject, shapeContext, tickPane, writeNote, writeSteering } from '../src/main/context.ts'
import { refreshMeaning } from '../src/main/meaning.ts'
import { moveMeaning } from '../src/main/meaning.ts'
import { listSessions, moveSessions, startSession } from '../src/main/sessions.ts'
import { commitContext, startRepository, uncommitted } from '../src/main/git.ts'
import { placeOf, refreshIndex, searchIndex, tagsInUse } from '../src/main/contextIndex.ts'
import { insertComment } from '../src/shared/comments.ts'

async function context(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-index-'))
  const write = async (relative: string, text: string) => {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true })
    await writeFile(path.join(root, relative), text)
  }
  await write('shelf/classification.md', '# Classification\n\nPublic data may leave the building.\n')
  await write(
    'projects/review/draft/document.md',
    insertComment('# Working copy\n\nPublic data may leave the building after review.\n', 'after review', 'Kdo to schválí?', 'ada')
  )
  await write('projects/review/intents.md', '# Intents\n\nSay what is true.\n')
  await write('projects/sibling/draft/notes.md', '# Notes\n\nNothing about data here.\n')
  await write('README.md', '# A context\n')
  await write('.git/description.md', 'Public data, but hidden.\n')
  return root
}

test('a file is labelled by where it stands in the context', () => {
  assert.deepEqual(placeOf('shelf/a/b.md'), { kind: 'shelf', project: null })
  assert.deepEqual(placeOf('projects/review/draft/document.md'), { kind: 'draft', project: 'review' })
  assert.deepEqual(placeOf('projects/review/intents.md'), { kind: 'project', project: 'review' })
  // Only the intents and the principles steer. What came in, and what is deeper in a folder, is material.
  assert.deepEqual(placeOf('projects/review/principles.md'), { kind: 'project', project: 'review' })
  // A folder inside draft/ keeps drafts too.
  assert.deepEqual(placeOf('projects/review/draft/deep/x.md'), { kind: 'draft', project: 'review' })
  assert.deepEqual(placeOf('projects/review/notes/deep/x.md'), { kind: 'material', project: 'review' })
  assert.deepEqual(placeOf('projects/review/dropbox/letter.md'), { kind: 'material', project: 'review' })
  assert.deepEqual(placeOf('projects/review/intents/AGENTS.md'), { kind: 'material', project: 'review' })
  assert.deepEqual(placeOf('projects/review/README.md'), { kind: 'material', project: 'review' })
  assert.deepEqual(placeOf('README.md'), { kind: 'context', project: null })
})

test('a search finds the shelf first, says what is a proposal, and reads comments', async () => {
  const root = await context()
  try {
    const index = await refreshIndex(root)
    assert.equal(index.files.some((file) => file.path.startsWith('.')), false)

    const hits = searchIndex(index, 'public DATA')
    assert.deepEqual(hits.map((hit) => [hit.kind, hit.path]), [
      ['shelf', 'shelf/classification.md'],
      ['draft', 'projects/review/draft/document.md']
    ])
    assert.equal(hits[0].match, 'Public data')
    assert.equal(index.files.find((file) => file.kind === 'shelf')?.text.slice(hits[0].start!, hits[0].start! + hits[0].length), 'Public data')
    // Not there as a phrase: the longest word is what is shown.
    assert.equal(searchIndex(index, 'building public')[0].match, 'building')

    // The marker is not prose. The words of the comment are found as a comment, accents or not.
    assert.equal(searchIndex(index, '@comment').length, 0)
    const [comment] = searchIndex(index, 'schvali')
    assert.deepEqual([comment.kind, comment.thread, comment.match, comment.start], ['draft', '1', 'schválí', null])

    assert.deepEqual(searchIndex(index, 'classification nothing'), [])
    assert.equal(searchIndex(index, 'intents')[0].path, 'projects/review/intents.md')
    assert.deepEqual(searchIndex(index, '   '), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the index is rebuilt from the files, and deleting it loses nothing', async () => {
  const root = await context()
  try {
    const file = path.join(root, '.indexes', 'context.json')
    await refreshIndex(root)
    assert.equal(await readFile(path.join(root, '.indexes', '.gitignore'), 'utf8'), '*\n')

    await rm(path.join(root, '.indexes'), { recursive: true })
    assert.equal(searchIndex(await refreshIndex(root), 'building').length, 2)
    assert.equal(existsSync(file), true)

    // A changed file is read again. A deleted one leaves the index.
    await writeFile(path.join(root, 'shelf/classification.md'), '# Classification\n\nNothing leaves the premises.\n')
    await rm(path.join(root, 'projects/sibling/draft/notes.md'))
    const index = await refreshIndex(root)
    assert.deepEqual(searchIndex(index, 'premises').map((hit) => hit.kind), ['shelf'])
    assert.equal(searchIndex(index, 'building').length, 1)
    assert.equal(index.files.some((entry) => entry.path.includes('sibling')), false)
    assert.equal(JSON.parse(await readFile(file, 'utf8')).files.length, index.files.length)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a pane is a file of the project: read with it, called a pane, and found after the sources', async () => {
  const root = await context()
  try {
    // A project with no panes folder opens as before.
    assert.deepEqual((await readProject(root, 'review')).panes, [])

    await mkdir(path.join(root, 'projects/review/panes'))
    await writeFile(path.join(root, 'projects/review/panes/tasks.md'), '# Tasks\n\n- [ ] Label the public data\n')
    await writeFile(path.join(root, 'projects/review/panes/notes.txt'), 'Not markdown, so not a pane.')
    const panes = (await readProject(root, 'review')).panes
    assert.deepEqual(panes.map((pane) => [pane.name, pane.text]), [['tasks.md', '# Tasks\n\n- [ ] Label the public data\n']])
    assert.ok(panes[0].written > 0)

    // An agent gathered it. It is not what is true, and it does not steer the project.
    assert.deepEqual(placeOf('projects/review/panes/tasks.md'), { kind: 'pane', project: 'review' })
    assert.deepEqual(searchIndex(await refreshIndex(root), 'public data').map((hit) => hit.kind), ['shelf', 'draft', 'pane'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a project lists the files in its folder, and opens with no draft', async () => {
  const root = await context()
  try {
    const write = async (relative: string) => {
      await mkdir(path.dirname(path.join(root, relative)), { recursive: true })
      await writeFile(path.join(root, relative), 'x')
    }
    await write('projects/review/dropbox/scans/letter.pdf')
    await write('projects/review/.cache/hidden.md')
    // A link is not followed: what it points at is not in the folder.
    await symlink(path.join(root, 'shelf'), path.join(root, 'projects/review/linked'))
    assert.deepEqual((await readProject(root, 'review')).files, ['draft/document.md', 'dropbox/scans/letter.pdf', 'intents.md'])

    // A project with nothing to review still opens.
    await write('projects/empty/notes.txt')
    const empty = await readProject(root, 'empty')
    assert.deepEqual([empty.drafts, empty.file, empty.text, empty.files], [[], null, '', ['notes.txt']])
    await assert.rejects(readProject(root, 'nowhere'), /not in this context/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a task in a pane is ticked in the file, one character, and only from the text that was shown', async () => {
  const root = await context()
  try {
    const file = path.join(root, 'projects/review/panes/tasks.md')
    await mkdir(path.dirname(file))
    const text = '# Tasks\r\n\r\n- [ ] Call Ada\r\n- [x] Send the copy\r\n\r\nNot a task: [ ] here.\r\n'
    await writeFile(file, text)
    const shown = (await readProject(root, 'review')).panes[0].text
    assert.equal(shown, text.replace(/\r\n/g, '\n'))

    // The box is found by where it is in the text the reader saw. The file keeps its line endings.
    const ticked = await tickPane(root, 'review', 'tasks.md', shown, shown.indexOf('[ ] Call'))
    assert.equal(await readFile(file, 'utf8'), text.replace('- [ ] Call', '- [x] Call'))
    const cleared = await tickPane(root, 'review', 'tasks.md', ticked.panes[0].text, ticked.panes[0].text.indexOf('[x] Send'))
    assert.equal(await readFile(file, 'utf8'), text.replace('- [ ] Call', '- [x] Call').replace('- [x] Send', '- [ ] Send'))

    const now = cleared.panes[0].text
    // Brackets that are not the box of a list item are not ticked, and nothing is, from a text that is no longer there.
    await assert.rejects(tickPane(root, 'review', 'tasks.md', now, now.indexOf('[ ] here')), /not a task box/)
    await assert.rejects(tickPane(root, 'review', 'tasks.md', now, 2), /not a task box/)
    await assert.rejects(tickPane(root, 'review', 'tasks.md', shown, shown.indexOf('[ ] Call')), /has changed since it was shown/)
    await assert.rejects(tickPane(root, 'review', '../intents.md', now, 0), /not in this project/)
    await assert.rejects(tickPane(root, 'review', 'missing.md', now, 0), /not in this project/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a #tag finds the documents whose front matter names it, at the tag, and the tags in use are counted', async () => {
  const root = await context()
  try {
    await writeFile(path.join(root, 'projects/review/draft/nda.md'), '---\ntags: Contract, legal\n---\n# NDA\n\nBoth sides keep it secret.\n')
    await writeFile(path.join(root, 'shelf/policy.md'), '---\ntags:\n  - contract\n---\n# Policy\n\nA #contract is not a tag here, it is a word.\n')
    const index = await refreshIndex(root)
    const hits = searchIndex(index, '#contract')
    assert.deepEqual(hits.map((hit) => hit.path).sort(), ['projects/review/draft/nda.md', 'shelf/policy.md'])
    const nda = hits.find((hit) => hit.path.endsWith('nda.md'))!
    assert.equal((await readFile(path.join(root, nda.path), 'utf8')).slice(nda.start!, nda.start! + nda.length), 'Contract')
    // A word that is no tag of any document finds nothing, and the others are counted without regard to case.
    assert.deepEqual(searchIndex(index, '#secret').map((hit) => hit.path), [])
    assert.deepEqual(tagsInUse(index), [{ tag: 'Contract', count: 2 }, { tag: 'legal', count: 1 }])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a draft is started in a folder, and a file or a folder is moved with what is kept beside it', async () => {
  const root = await context()
  try {
    const project = path.join(root, 'projects/review')
    await makeFolder(root, 'review', 'draft/WEF')
    await makeFolder(root, 'review', 'notes')
    const started = await createDraft(root, 'review', 'design', 'WEF')
    assert.equal(started.file, 'WEF/design.md')
    assert.equal(await readFile(path.join(project, 'draft/WEF/design.md'), 'utf8'), '# design\n')
    await assert.rejects(createDraft(root, 'review', 'x', 'missing'), /not in the drafts/)
    await assert.rejects(createDraft(root, 'review', 'x', '../outside'), /not a folder of the drafts/)
    await assert.rejects(createDraft(root, 'review', 'design', 'WEF'), /already there/)

    // A text file goes with its comments and its note, and its twin goes with it.
    await writeFile(path.join(project, 'sysmon.xml'), '<a/>\n')
    await writeFile(path.join(project, 'sysmon.xml.comments.md'), 'c\n')
    await writeFile(path.join(project, 'sysmon.xml.notes.md'), 'n\n')
    await writeFile(path.join(project, 'old.pdf'), 'pdf')
    await mkdir(path.join(root, '.indexes/text/projects/review'), { recursive: true })
    await writeFile(path.join(root, '.indexes/text/projects/review/old.pdf.txt'), 'text of the pdf')
    const moved = await moveEntry(root, 'review', 'sysmon.xml', 'notes')
    assert.deepEqual(moved, { from: 'projects/review/sysmon.xml', to: 'projects/review/notes/sysmon.xml', folder: false })
    assert.deepEqual((await readdir(path.join(project, 'notes'))).sort(), ['sysmon.xml', 'sysmon.xml.comments.md', 'sysmon.xml.notes.md'])
    assert.equal(existsSync(path.join(project, 'sysmon.xml')), false)
    await moveEntry(root, 'review', 'old.pdf', 'notes')
    assert.equal(await readFile(path.join(root, '.indexes/text/projects/review/notes/old.pdf.txt'), 'utf8'), 'text of the pdf')

    // A draft moved out of draft/ is material, and the other way round it is a draft.
    await moveEntry(root, 'review', 'draft/WEF/design.md', 'notes')
    assert.equal((await readProject(root, 'review')).drafts.includes('WEF/design.md'), false)
    assert.equal(placeOf('projects/review/notes/design.md').kind, 'material')
    await moveEntry(root, 'review', 'notes/design.md', 'draft')
    assert.ok((await readProject(root, 'review')).drafts.includes('design.md'))

    // A folder goes whole. Not into itself, not where it is, and not over a name that is there.
    await moveEntry(root, 'review', 'notes', 'draft/WEF')
    assert.ok(existsSync(path.join(project, 'draft/WEF/notes/sysmon.xml.notes.md')))
    await assert.rejects(moveEntry(root, 'review', 'draft/WEF', 'draft/WEF/notes'), /into itself/)
    await assert.rejects(moveEntry(root, 'review', 'draft/design.md', 'draft'), /in that folder already/)
    await writeFile(path.join(project, 'draft/WEF/design.md'), 'there')
    await assert.rejects(moveEntry(root, 'review', 'draft/design.md', 'draft/WEF'), /already there/)

    // What a project keeps for itself stays, nothing leaves the project, and a side file moves with its file.
    for (const [from, to, why] of [
      ['draft', 'draft/WEF', /keeps it for itself/],
      ['intents.md', 'draft', /keeps it for itself/],
      ['draft/design.md', 'panes', /panes\/ or scripts\//],
      ['draft/design.md', '../shelf', /cannot be moved/],
      ['../../shelf/classification.md', 'draft', /cannot be moved/],
      ['draft/WEF/notes/sysmon.xml.notes.md', 'draft', /go with it/],
      ['draft/design.md', 'missing', /not in this project/],
      ['draft/nothing.md', 'draft/WEF', /not in this project/]
    ] as const) await assert.rejects(moveEntry(root, 'review', from, to), why, `${from} -> ${to}`)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a request goes into the dropbox of another project as one file, and the sender keeps a line about it', async () => {
  const root = await context()
  const outside = `${root}-outside`
  try {
    await createProject(root, 'regulations')
    const sent = await sendToProject(root, 'review', 'draft/document.md', 'regulations', 'Public data may leave\nafter review.', 'The rule is too strict for the lab.')
    assert.match(sent, /^projects\/regulations\/dropbox\/from-review-\d{8}-\d{6}\.md$/)
    const text = await readFile(path.join(root, sent), 'utf8')
    assert.match(text, /^---\nfrom: review\/draft\/document\.md\nsent: \d{4}-/)
    assert.match(text, /# Request from review\n\nThe rule is too strict for the lab\.\n\n> Public data may leave\n> after review\.\n\nFrom `draft\/document\.md` in review, /)
    // The other project is changed in its dropbox and nowhere else. A second request in the same second is another file.
    assert.deepEqual((await readdir(path.join(root, 'projects/regulations'))).sort(), ['dropbox', 'draft', 'intents.md', 'principles.md'].sort())
    const again = await sendToProject(root, 'review', 'draft/document.md', 'regulations', 'Another passage.', '')
    assert.notEqual(again, sent)
    assert.equal((await readdir(path.join(root, 'projects/regulations/dropbox'))).length, 2)
    // The sender keeps a line in the note beside the file.
    const note = await readFile(path.join(root, 'projects/review/draft/document.md.notes.md'), 'utf8')
    assert.match(note, /^Sent to regulations on \d{4}-\d{2}-\d{2}: The rule is too strict for the lab\.\nSent to regulations on \d{4}-\d{2}-\d{2}\n$/)

    await assert.rejects(sendToProject(root, 'review', 'draft/document.md', 'review', 'x', ''), /another project/)
    await assert.rejects(sendToProject(root, 'review', 'draft/document.md', 'missing', 'x', ''), /not in this context/)
    await assert.rejects(sendToProject(root, 'review', 'draft/document.md', 'regulations', '  ', 'x'), /Select the passage/)
    await assert.rejects(sendToProject(root, 'review', 'draft/document.md', 'regulations', 'x'.repeat(20_001), ''), /too long/)
    // A dropbox that is a link leading out of the context is not written through.
    await createProject(root, 'lab')
    await mkdir(outside)
    await rm(path.join(root, 'projects/lab/dropbox'), { recursive: true, force: true })
    await symlink(outside, path.join(root, 'projects/lab/dropbox'))
    await assert.rejects(sendToProject(root, 'review', 'draft/document.md', 'lab', 'x', ''), /leaves the context/)
    assert.deepEqual(await readdir(outside), [])
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test('the drafts that say they are final are told with the project, and a long front matter is not read', async () => {
  const root = await context()
  try {
    await writeFile(path.join(root, 'projects/review/draft/done.md'), '---\ntags: a\nstatus: final\n---\n# Done\n')
    await writeFile(path.join(root, 'projects/review/draft/open.md'), '---\nstatus: draft\n---\n# Open\n')
    await writeFile(path.join(root, 'projects/review/draft/body.md'), '# Not front matter\n\nstatus: final\n')
    await writeFile(path.join(root, 'projects/review/draft/long.md'), `---\ntitle: ${'x'.repeat(5000)}\nstatus: final\n---\n# Long\n`)
    const view = await readProject(root, 'review')
    assert.deepEqual(view.final, ['done.md'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a file has a note beside it, written from the text the reader began from, and it is material and not a draft', async () => {
  const root = await context()
  try {
    const note = path.join(root, 'projects/review/draft/document.md.notes.md')
    assert.equal(await readNote(root, 'review', 'draft/document.md'), '')
    // A note is begun by a word, and it is written beside the file.
    await assert.rejects(writeNote(root, 'review', 'draft/document.md', '', '  \n'), /The note is empty/)
    assert.equal(await writeNote(root, 'review', 'draft/document.md', '', 'Based on [[policy.md]].\n'), 'Based on [[policy.md]].\n')
    assert.equal(await readFile(note, 'utf8'), 'Based on [[policy.md]].\n')
    assert.equal(await readNote(root, 'review', 'draft/document.md'), 'Based on [[policy.md]].\n')
    // Another text by now: nothing is written over it.
    await assert.rejects(writeNote(root, 'review', 'draft/document.md', '', 'Lost.\n'), /has changed since you began/)
    assert.equal(await readFile(note, 'utf8'), 'Based on [[policy.md]].\n')
    await writeNote(root, 'review', 'draft/document.md', 'Based on [[policy.md]].\n', 'Based on [[policy.md]].\nAnd more.\n')

    // A note is not a draft, and is material wherever its file is.
    assert.equal((await readProject(root, 'review')).drafts.some((name) => name.includes('.notes.')), false)
    assert.equal(placeOf('projects/review/draft/document.md.notes.md').kind, 'material')
    assert.equal(placeOf('projects/review/sysmon.xml.notes.md').kind, 'material')
    const index = await refreshIndex(root)
    assert.equal(index.files.find((file) => file.path.endsWith('document.md.notes.md'))?.kind, 'material')

    // Only a file of the project that is there, not hidden, and not itself a comment file or a note.
    await assert.rejects(readNote(root, 'review', 'draft/missing.md'), /not in this project/)
    await assert.rejects(readNote(root, 'review', '../intents.md'), /has no note/)
    await assert.rejects(readNote(root, 'review', 'draft/document.md.notes.md'), /has no note/)
    await assert.rejects(readNote(root, 'review', 'draft/x.comments.md'), /has no note/)
    await assert.rejects(writeNote(root, 'review', '.indexes/x', '', 'x'), /has no note/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a folder is made in a project, and drafts lie in folders of draft/ as they do in draft/', async () => {
  const root = await context()
  try {
    const made = await makeFolder(root, 'review', 'draft/contracts')
    assert.ok(made.folders.includes('draft/contracts'), 'an empty folder is listed')
    await makeFolder(root, 'review', 'notes')
    await writeFile(path.join(root, 'projects/review/draft/contracts/nda.md'), '# NDA\n\nBoth sides keep it secret.\n')

    const view = await readProject(root, 'review', 'contracts/nda.md')
    assert.ok(view.drafts.includes('contracts/nda.md'))
    assert.equal(view.file, 'contracts/nda.md')
    assert.equal(placeOf('projects/review/draft/contracts/nda.md').kind, 'draft')
    assert.equal(placeOf('projects/review/notes/a.md').kind, 'material')
    // A comment goes into the draft in the folder, and nowhere else.
    await addComment(root, 'review', 'contracts/nda.md', 'keep it secret', 'Which law?', 'you', 0)
    assert.match(await readFile(path.join(root, 'projects/review/draft/contracts/nda.md'), 'utf8'), /@comment/)

    // The folders a project keeps for itself are not made, a name is a name and not a path out, and nothing is made over.
    await assert.rejects(makeFolder(root, 'review', 'draft'), /keeps draft\/ for itself/)
    await assert.rejects(makeFolder(root, 'review', 'dropbox'), /keeps dropbox\/ for itself/)
    await assert.rejects(makeFolder(root, 'review', 'panes/x'), /keeps panes\/ for itself/)
    await assert.rejects(makeFolder(root, 'review', '../outside'), /Name the folder/)
    await assert.rejects(makeFolder(root, 'review', 'missing/inside'), /not in this project/)
    await assert.rejects(makeFolder(root, 'review', 'notes'), /already there/)
    await assert.rejects(makeFolder(root, 'review', 'draft/contracts/nda.md'), /already there/)
    assert.equal(existsSync(path.join(root, 'outside')), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the intents and the principles are written from the text the reader began from, and no other file is', async () => {
  const root = await context()
  try {
    const file = path.join(root, 'projects/review/intents.md')
    await writeFile(file, '# Intents\r\n\r\nLean on the shelf.\r\n')
    const shown = (await readProject(root, 'review')).intents
    // A text area gives LF. The file keeps its line endings.
    const saved = await writeSteering(root, 'review', 'intents', shown, '# Intents\n\nLean on the shelf, then the notes.\n')
    assert.equal(await readFile(file, 'utf8'), '# Intents\r\n\r\nLean on the shelf, then the notes.\r\n')
    assert.match(saved.intents, /then the notes/)
    // Written meanwhile by someone else: nothing is written over it.
    await assert.rejects(writeSteering(root, 'review', 'intents', shown, 'Lost.\n'), /has changed since you began/)
    assert.match(await readFile(file, 'utf8'), /then the notes/)
    // Only these two files, and only inside the project.
    await assert.rejects(writeSteering(root, 'review', 'tasks', '', 'x'), /Only the intents and the principles/)
    await assert.rejects(writeSteering(root, 'review', '../intents', '', 'x'), /Only the intents and the principles/)
    await assert.rejects(writeSteering(root, '../review', 'intents', '', 'x'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a context and a project are started as new folders, and nothing that is there is made over', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-new-'))
  try {
    const dir = path.join(root, 'work')
    await createContext(dir)
    assert.deepEqual((await readdir(dir)).sort(), ['dropbox', 'projects', 'shelf'])
    assert.deepEqual(await listProjects(dir), [])
    await assert.rejects(createContext(dir), /already there/)

    // A project has a place for drafts and the two files that steer it. It opens with no draft.
    assert.equal(await createProject(dir, '  Client letter '), 'Client letter')
    assert.deepEqual(await listProjects(dir), ['Client letter'])
    const view = await readProject(dir, 'Client letter')
    assert.deepEqual([view.drafts, view.files], [[], ['intents.md', 'principles.md']])
    assert.match(await readFile(path.join(dir, 'projects/Client letter/intents.md'), 'utf8'), /^# Intents\n/)
    assert.equal(existsSync(path.join(dir, 'projects/Client letter/draft')), true)

    // One that is there is not started again, and a name is never a path.
    await assert.rejects(createProject(dir, 'Client letter'), /already there/)
    for (const name of ['', ' ', '../out', 'a/b', '.hidden']) await assert.rejects(createProject(dir, name), /Name the project/)
    assert.deepEqual(await readdir(root), ['work'])

    // Any folder can become a context: it gets its projects folder with its first project.
    const bare = path.join(root, 'bare')
    await mkdir(bare)
    await createProject(bare, 'first')
    assert.deepEqual(await listProjects(bare), ['first'])

    // A projects folder that is a link to somewhere else is not written into.
    const linked = path.join(root, 'linked')
    await mkdir(linked)
    await mkdir(path.join(root, 'elsewhere'))
    await symlink(path.join(root, 'elsewhere'), path.join(linked, 'projects'))
    await assert.rejects(createProject(linked, 'stray'), /leaves the context/)
    assert.deepEqual(await readdir(path.join(root, 'elsewhere')), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a folder that is opened is made a context where it stands, and a repository is started only where there is none', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-init-'))
  try {
    // Somebody's folder, with work in it already. It is not a context, and it is in no repository.
    const dir = path.join(root, 'notes')
    await mkdir(path.join(dir, 'shelf'), { recursive: true })
    await writeFile(path.join(dir, 'shelf/terms.md'), 'Kept.\n')
    await writeFile(path.join(dir, 'README.md'), 'Mine.\n')
    assert.deepEqual(await describeContext(dir), { dir, projects: [], shaped: false, tracked: false })

    await shapeContext(dir)
    assert.deepEqual((await readdir(dir)).sort(), ['README.md', 'dropbox', 'projects', 'shelf'])
    assert.equal(await readFile(path.join(dir, 'shelf/terms.md'), 'utf8'), 'Kept.\n')
    assert.equal((await describeContext(dir)).shaped, true)

    // Git starts the repository and nothing else: nothing is committed.
    await startRepository(dir, process.env)
    assert.equal(existsSync(path.join(dir, '.git/HEAD')), true)
    assert.equal(existsSync(path.join(dir, '.git/index')), false)
    assert.equal((await describeContext(dir)).tracked, true)

    // In a repository already, its own or one above it, git is not run: a context may have brought its config.
    await assert.rejects(startRepository(dir, process.env), /in a git repository already/)
    const inner = path.join(dir, 'projects/one')
    await mkdir(inner)
    assert.equal((await describeContext(inner)).tracked, true)
    await assert.rejects(startRepository(inner, process.env), /in a git repository already/)
    assert.equal(existsSync(path.join(inner, '.git')), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a commit takes what has changed in the context, in the words given, and nothing beside the context', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-commit-'))
  // The words of a commit and who made it, without the settings of whoever runs the test.
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Reader', GIT_AUTHOR_EMAIL: 'reader@example.com', GIT_COMMITTER_NAME: 'Reader', GIT_COMMITTER_EMAIL: 'reader@example.com' }
  const log = (dir: string) => new Promise<string>((resolve) => execFile('git', ['log', '--format=%s', '--name-only'], { cwd: dir, env }, (_failed, out) => resolve(out.trim())))
  try {
    // A repository that holds more than the context: something beside it is changed, and staged.
    const dir = path.join(root, 'work')
    await createContext(dir)
    await startRepository(root, env)
    await writeFile(path.join(root, 'beside.txt'), 'Not the context.\n')
    await new Promise((resolve) => execFile('git', ['add', 'beside.txt'], { cwd: root, env }, resolve))
    await createProject(dir, 'letter')
    assert.equal(await uncommitted(dir, env), 2)

    // The first commit of the repository. The words are one value, whatever they begin with.
    await assert.rejects(commitContext(dir, '  ', env), /Say what changed/)
    assert.equal(await commitContext(dir, '--amend the letter', env), 2)
    assert.equal(await log(root), '--amend the letter\n\nwork/projects/letter/intents.md\nwork/projects/letter/principles.md')
    assert.equal(await uncommitted(dir, env), 0)
    await assert.rejects(commitContext(dir, 'Again', env), /Nothing has changed/)

    // A changed file and a new one are both taken. What Mate keeps for itself is not: it ignores itself.
    await writeFile(path.join(dir, 'projects/letter/intents.md'), '# Intents\n\nBe brief.\n')
    await writeFile(path.join(dir, 'shelf/terms.md'), 'Terms.\n')
    await mkdir(path.join(dir, '.indexes'))
    await writeFile(path.join(dir, '.indexes/.gitignore'), '*\n')
    await writeFile(path.join(dir, '.indexes/context.json'), '{}')
    // A project that is a repository of its own is left to it: the context's commit does not take it in.
    await mkdir(path.join(dir, 'projects/own'), { recursive: true })
    await new Promise((resolve) => execFile('git', ['init'], { cwd: path.join(dir, 'projects/own'), env }, resolve))
    await writeFile(path.join(dir, 'projects/own/notes.md'), 'Its own.\n')
    assert.equal(await uncommitted(dir, env), 2)
    assert.equal(await commitContext(dir, 'Terms on the shelf', env), 2)
    assert.match(await log(root), /^Terms on the shelf\n\nwork\/projects\/letter\/intents.md\nwork\/shelf\/terms.md\n/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a context and a project are renamed where they stand, and what belongs to them goes with them', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-rename-'))
  try {
    const first = path.join(root, 'Untitled')
    await createContext(first)
    await createProject(first, 'Clasification')
    await writeFile(path.join(first, 'projects/Clasification/draft/scheme.md'), '# Scheme\n\nFour levels.\n')
    const session = await startSession(first, 'Clasification', 'hermes')

    // The context: its folder takes the name, with all that is in it. A name is never a path, and never another's folder.
    await mkdir(path.join(root, 'Taken'))
    await assert.rejects(renameContext(first, 'Taken'), /already there/)
    for (const name of ['', '../out', 'a/b', '.hidden']) await assert.rejects(renameContext(first, name), /Name the context/)
    const context = await renameContext(first, 'Client A')
    assert.equal(context, path.join(root, 'Client A'))
    assert.equal(existsSync(first), false)
    assert.deepEqual(await listProjects(context), ['Clasification'])
    // Only the capitals changed: it is the same folder, and that is no clash.
    assert.equal(await renameContext(context, 'client a'), path.join(root, 'client a'))
    const dir = path.join(root, 'client a')

    // The project: its folder, its sessions told their new project, and the vectors of its files, so none is learned again.
    let asked = 0
    const embed = async (texts: string[]) => ((asked += texts.length), texts.map(() => [1, 0]))
    assert.equal(await refreshMeaning(dir, await refreshIndex(dir), embed), 3)
    await assert.rejects(renameProject(dir, 'Missing', 'Other'), /not in this context/)
    const made = await renameProject(dir, 'Clasification', 'Classification')
    assert.equal(made, 'Classification')
    await moveSessions(dir, 'Clasification', made)
    await moveMeaning(dir, 'projects/Clasification/', 'projects/Classification/')
    assert.deepEqual(await listProjects(dir), ['Classification'])
    assert.equal((await readProject(dir, 'Classification', 'scheme.md')).text, '# Scheme\n\nFour levels.\n')
    assert.deepEqual((await listSessions(dir, 'Classification')).map((each) => [each.id, each.project]), [[session.id, 'Classification']])
    asked = 0
    assert.equal(await refreshMeaning(dir, await refreshIndex(dir), embed), 0)
    assert.equal(asked, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a folder brought in as a project is moved as it is, and its markdown files are its drafts where they lie', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-import-'))
  const context = path.join(root, 'client')
  const repo = path.join(root, 'policy-repo')
  try {
    await createContext(context)
    await mkdir(path.join(repo, 'docs'), { recursive: true })
    await mkdir(path.join(repo, '.git'))
    await writeFile(path.join(repo, '.git/HEAD'), 'ref: refs/heads/main\n')
    await writeFile(path.join(repo, 'README.md'), '# Policies\n\nWhat this repository holds.\n')
    await writeFile(path.join(repo, 'docs/access.md'), '# Access\n\nAdmins use two factors.\n')
    await writeFile(path.join(repo, 'intents.md'), '# Intents\n')

    // Never into itself, never what holds the context, never a name that could be a path.
    await assert.rejects(importProject(context, path.join(context, 'shelf')), /in this context already/)
    await assert.rejects(importProject(context, root), /inside that folder/)
    assert.equal(await importProject(context, repo), 'policy-repo')
    assert.equal(existsSync(repo), false)
    // Nothing in it changed: no draft folder, no files of Mate's. Its repository came with it.
    const moved = path.join(context, 'projects/policy-repo')
    assert.deepEqual((await readdir(moved)).sort(), ['.git', 'README.md', 'docs', 'intents.md'])
    await mkdir(repo)
    await assert.rejects(importProject(context, repo), /already in this context/)

    // Its drafts are its markdown files where they lie, but the file that steers it.
    const view = await readProject(context, 'policy-repo')
    assert.deepEqual([view.drafts, view.draftsIn], [['README.md', 'docs/access.md'], ''])
    const opened = await readProject(context, 'policy-repo', 'docs/access.md')
    assert.equal(opened.text, '# Access\n\nAdmins use two factors.\n')
    // A comment goes into the file where it lies, and search calls it a proposal.
    const commented = await addComment(context, 'policy-repo', 'docs/access.md', 'Admins use two factors.', 'Which two?', 'you')
    assert.equal(commented.comments.length, 1)
    assert.match(await readFile(path.join(moved, 'docs/access.md'), 'utf8'), /@comment/)
    const hits = searchIndex(await refreshIndex(context), 'two factors')
    assert.deepEqual([...new Set(hits.map((hit) => `${hit.kind} ${hit.path}`))], ['draft projects/policy-repo/docs/access.md'])
    // A new draft goes where the others are, and does not make a draft folder.
    await createDraft(context, 'policy-repo', 'Next')
    assert.equal(existsSync(path.join(moved, 'Next.md')), true)
    assert.equal(existsSync(path.join(moved, 'draft')), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
