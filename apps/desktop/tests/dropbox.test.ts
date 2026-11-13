import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { addDropbox, createProject, readProject } from '../src/main/context.ts'

test('a new project has a dropbox from the start, and a project made before gets one from the menu', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-'))
  try {
    await mkdir(path.join(root, 'projects'), { recursive: true })
    await createProject(root, 'Fresh')
    assert.ok((await readProject(root, 'Fresh')).folders.includes('dropbox'), 'a new project has a dropbox')

    // A project made before, with no dropbox. Adding one changes nothing else, and does it again without harm.
    await mkdir(path.join(root, 'projects/Old/draft'), { recursive: true })
    await writeFile(path.join(root, 'projects/Old/draft/a.md'), '# A\n')
    assert.equal((await readProject(root, 'Old')).folders.includes('dropbox'), false)
    const added = await addDropbox(root, 'Old')
    assert.ok(added.folders.includes('dropbox'))
    assert.equal(existsSync(path.join(root, 'projects/Old/dropbox')), true)
    assert.deepEqual(added.drafts, ['a.md'])
    await addDropbox(root, 'Old')
    await assert.rejects(addDropbox(root, 'missing'), /not in this context/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
