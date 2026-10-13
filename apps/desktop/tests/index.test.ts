import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { readProject, tickPane } from '../src/main/context.ts'
import { placeOf, refreshIndex, searchIndex } from '../src/main/contextIndex.ts'
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
  assert.deepEqual(placeOf('projects/review/draft/deep/x.md'), { kind: 'material', project: 'review' })
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

    await write('projects/empty/README.md')
    const empty = await readProject(root, 'empty')
    assert.deepEqual([empty.drafts, empty.file, empty.text, empty.files], [[], null, '', ['README.md']])
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
