import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { paneDisk, placeOnDisk, readContextFile, readProject, tickPane } from '../src/main/context.ts'
import { refreshIndex, searchIndex } from '../src/main/contextIndex.ts'

test('a pane is kept in the context, named as a file of its project, and the project holds none', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-'))
  try {
    await mkdir(path.join(root, 'projects/review/draft'), { recursive: true })
    await writeFile(path.join(root, 'projects/review/draft/a.md'), '# A\n')
    assert.equal(paneDisk('projects/review/panes/tasks.md'), '.mate/projects/review/panes/tasks.md')
    assert.equal(paneDisk('projects/review/draft/a.md'), 'projects/review/draft/a.md', 'only a pane moves')
    assert.equal(paneDisk('projects/review/panes/x/y.md'), '.mate/projects/review/panes/x/y.md')

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
