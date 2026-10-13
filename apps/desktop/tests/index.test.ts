import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createContext, createProject, describeContext, listProjects, readProject, shapeContext, tickPane } from '../src/main/context.ts'
import { commitContext, startRepository, uncommitted } from '../src/main/git.ts'
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
    assert.equal(await commitContext(dir, 'Terms on the shelf', env), 2)
    assert.match(await log(root), /^Terms on the shelf\n\nwork\/projects\/letter\/intents.md\nwork\/shelf\/terms.md\n/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
