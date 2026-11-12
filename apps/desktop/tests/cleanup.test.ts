import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { cleanUp, leftovers, markDone, offered } from '../src/main/cleanup.ts'
import { readProject } from '../src/main/context.ts'
import { insertComment, separate, setCommentPrivate } from '../src/shared/comments.ts'

test('older comment files leave the projects, and comments written into a repository leave its files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-'))
  try {
    // A text file with the comment file an older version kept beside it.
    const config = path.join(root, 'projects', 'review', 'config')
    await mkdir(config, { recursive: true })
    const xml = '<a>\n  <b/>\n</a>\n'
    await writeFile(path.join(config, 'x.xml'), xml)
    await writeFile(path.join(config, 'x.xml.comments.md'), separate(insertComment(xml, '<b/>', 'Why?', 'ada'), 'x.xml').side)
    // A repository with a comment written in its file, and a project that is no repository with one too.
    const guide = '# Guide\n\nRun it on port 8080.\n'
    const shared = setCommentPrivate(insertComment(guide, 'port 8080', 'Is it?', 'you'), '1', false)
    for (const name of ['repo', 'plain']) {
      await mkdir(path.join(root, 'projects', name), { recursive: true })
      await writeFile(path.join(root, 'projects', name, 'guide.md'), shared)
    }
    await mkdir(path.join(root, 'projects', 'repo', '.git'))

    assert.equal(await offered(root), true)
    // Names alone find the comment file. Reading the drafts finds only the repository's.
    assert.deepEqual((await leftovers(root, false)).sidecars, [{ project: 'review', file: 'config/x.xml' }])
    const found = await leftovers(root, true)
    assert.deepEqual(found.written, [{ project: 'repo', file: 'guide.md', comments: 1 }])

    assert.deepEqual(await cleanUp(root, found), { moved: 1, taken: 1, left: 0 })
    assert.equal(existsSync(path.join(config, 'x.xml.comments.md')), false)
    assert.equal((await readProject(root, 'review', 'config/x.xml')).comments[0].text, 'Why?')
    // The repository's file is its own again, and the comment is kept in the context.
    assert.equal(await readFile(path.join(root, 'projects', 'repo', 'guide.md'), 'utf8'), guide)
    assert.equal((await readProject(root, 'repo', 'guide.md')).comments[0].text, 'Is it?')
    // A project that is no repository keeps what it has.
    assert.equal(await readFile(path.join(root, 'projects', 'plain', 'guide.md'), 'utf8'), shared)
    assert.deepEqual(await leftovers(root, true), { sidecars: [], written: [] })
    // It is a one-off: once done, the context is not asked again, and a context with nothing to do is not asked at all.
    assert.equal(await offered(root), true, 'a repository is still offered until the reader has said yes once')
    await markDone(root)
    assert.equal(await offered(root), false)
    const bare = await mkdtemp(path.join(tmpdir(), 'mate-'))
    await mkdir(path.join(bare, 'projects', 'plain'), { recursive: true })
    assert.equal(await offered(bare), false)
    await rm(bare, { recursive: true, force: true })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
