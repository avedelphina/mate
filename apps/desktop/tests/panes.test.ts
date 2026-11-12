import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { keptDisk, moveEntry, placeOnDisk, readContextFile, readNote, readProject, tickPane, writeNote } from '../src/main/context.ts'
import { refreshIndex, searchIndex } from '../src/main/contextIndex.ts'

test('a pane is kept in the context, named as a file of its project, and the project holds none', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-'))
  try {
    await mkdir(path.join(root, 'projects/review/draft'), { recursive: true })
    await writeFile(path.join(root, 'projects/review/draft/a.md'), '# A\n')
    assert.equal(keptDisk('projects/review/panes/tasks.md'), '.mate/projects/review/panes/tasks.md')
    assert.equal(keptDisk('projects/review/draft/a.md'), 'projects/review/draft/a.md', 'only a pane or a note moves')
    assert.equal(keptDisk('projects/review/draft/a.md.notes.md'), '.mate/projects/review/draft/a.md.notes.md')
    assert.equal(keptDisk('projects/review/panes/x/y.md'), '.mate/projects/review/panes/x/y.md')

    // A pane an agent wrote into the context is shown, found by search, read by its name in the project, and ticked.
    const pane = path.join(root, '.mate/projects/review/panes/tasks.md')
    await mkdir(path.dirname(pane), { recursive: true })
    await writeFile(pane, '# Tasks\n\n- [ ] Label the data\n')
    const view = await readProject(root, 'review')
    assert.deepEqual(view.panes.map((each) => each.name), ['tasks.md'])
    assert.equal((await readContextFile(root, 'projects/review/panes/tasks.md')).kind, 'pane')
    assert.ok((await placeOnDisk(root, 'projects/review/panes/tasks.md')).endsWith('.mate/projects/review/panes/tasks.md'))
    const hits = searchIndex(await refreshIndex(root), 'Label the data')
    assert.deepEqual([...new Set(hits.map((hit) => `${hit.kind} ${hit.path}`))], ['pane projects/review/panes/tasks.md'])
    const text = view.panes[0].text
    const ticked = await tickPane(root, 'review', 'tasks.md', text, text.indexOf('[ ]'))
    assert.match(await readFile(pane, 'utf8'), /- \[x\] Label the data/)
    assert.equal(ticked.panes[0].text.includes('[x]'), true)
    assert.equal(existsSync(path.join(root, 'projects/review/panes')), false, 'nothing of it is in the project')

    // One an older version left in the project is shown until the clean-up, and the context's wins by name.
    await mkdir(path.join(root, 'projects/review/panes'))
    await writeFile(path.join(root, 'projects/review/panes/tasks.md'), 'Old.\n')
    await writeFile(path.join(root, 'projects/review/panes/old.md'), 'Older.\n')
    const both = await readProject(root, 'review')
    assert.deepEqual(both.panes.map((each) => [each.name, each.text.startsWith('# Tasks')]), [['old.md', false], ['tasks.md', true]])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the note about a file is kept in the context, found by search under the file, and goes with the file', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-'))
  try {
    await mkdir(path.join(root, 'projects/review/draft'), { recursive: true })
    await mkdir(path.join(root, 'projects/review/other'))
    await writeFile(path.join(root, 'projects/review/draft/a.md'), '# A\n')
    await writeFile(path.join(root, 'projects/review/data.csv'), 'a,b\n')
    await writeNote(root, 'review', 'data.csv', '', 'Exported from the tracker, see [[a.md]].\n')
    assert.equal(await readFile(path.join(root, '.mate/projects/review/data.csv.notes.md'), 'utf8'), 'Exported from the tracker, see [[a.md]].\n')
    assert.equal(existsSync(path.join(root, 'projects/review/data.csv.notes.md')), false, 'the project holds no note')
    // Search finds it as the file's note, named as a file of the project, and an agent reads it by that name.
    const hits = searchIndex(await refreshIndex(root), 'tracker')
    assert.deepEqual([...new Set(hits.map((hit) => `${hit.kind} ${hit.path}`))], ['material projects/review/data.csv.notes.md'])
    assert.match((await readContextFile(root, 'projects/review/data.csv.notes.md')).text, /Exported from the tracker/)
    // It goes with the file.
    await moveEntry(root, 'review', 'data.csv', 'other')
    assert.equal(await readNote(root, 'review', 'other/data.csv'), 'Exported from the tracker, see [[a.md]].\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

