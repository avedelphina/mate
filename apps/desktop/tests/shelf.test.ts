import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { listShelf, publish, readProject, takeDown } from '../src/main/context.ts'
import { refreshIndex, searchIndex } from '../src/main/contextIndex.ts'

async function context(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-shelf-'))
  await mkdir(path.join(root, 'projects/review/draft'), { recursive: true })
  await mkdir(path.join(root, 'shelf'))
  await writeFile(
    path.join(root, 'projects/review/draft/policy.md'),
    '# Policy\r\n\r\nPublic data may leave.\r\n<!-- @comment{"id":"1","anchor":"Public data may leave.","text":"Who says?","author":"ada"} -->\r\n'
  )
  return root
}

test('publishing puts the text of a draft on the shelf, and keeps what was there as history', async () => {
  const root = await context()
  try {
    const draft = path.join(root, 'projects/review/draft/policy.md')
    const before = await readFile(draft, 'utf8')

    // The shelf gets the text the page shows: no comment, and the line endings the draft has.
    assert.deepEqual(await publish(root, 'review', 'policy.md', 'policy'), { path: 'shelf/policy.md', replaced: false })
    assert.equal(await readFile(path.join(root, 'shelf/policy.md'), 'utf8'), '# Policy\r\n\r\nPublic data may leave.\r\n')
    // The draft is as it was, comment and all. It is a proposal again.
    assert.equal(await readFile(draft, 'utf8'), before)
    assert.deepEqual(await readdir(path.join(root, 'shelf')), ['policy.md'])

    // Published again: the shelf has the new text, and the old one is kept beside it, hidden.
    await writeFile(draft, '# Policy\n\nNothing leaves.\n')
    assert.deepEqual(await publish(root, 'review', 'policy.md', 'policy.md'), { path: 'shelf/policy.md', replaced: true })
    assert.equal(await readFile(path.join(root, 'shelf/policy.md'), 'utf8'), '# Policy\n\nNothing leaves.\n')
    const history = await readdir(path.join(root, 'shelf/.history/policy.md'))
    assert.equal(history.length, 1)
    assert.equal(await readFile(path.join(root, 'shelf/.history/policy.md', history[0]), 'utf8'), '# Policy\r\n\r\nPublic data may leave.\r\n')
    // What was true before is not current: the shelf does not list it, and a search does not find it.
    assert.deepEqual(await listShelf(root), ['policy.md'])
    assert.deepEqual(searchIndex(await refreshIndex(root), 'public data').map((hit) => hit.path), [])
    assert.deepEqual(searchIndex(await refreshIndex(root), 'nothing leaves').map((hit) => hit.kind), ['shelf', 'draft'])

    // A folder may be named. Nothing else may: not a hidden name, not a way out.
    assert.equal((await publish(root, 'review', 'policy.md', 'rules/data')).path, 'shelf/rules/data.md')
    assert.deepEqual(await listShelf(root), ['policy.md', 'rules/data.md'])
    for (const name of ['', '.hidden', '../up', 'a/../b', 'a//b', '/abs']) await assert.rejects(publish(root, 'review', 'policy.md', name), /Name the shelf document/)
    await assert.rejects(publish(root, 'review', 'missing.md', 'x'), /not in this project/)
    await assert.rejects(publish(root, 'review', '../../shelf/policy.md', 'x'), /not in this project/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a shelf that is a link to somewhere else is not published into', async () => {
  const root = await context()
  const outside = `${root}-outside`
  try {
    await mkdir(outside)
    await rm(path.join(root, 'shelf'), { recursive: true })
    await symlink(outside, path.join(root, 'shelf'))
    await assert.rejects(publish(root, 'review', 'policy.md', 'policy'), /leaves the context/)
    assert.deepEqual(await readdir(outside), [])
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test('a shelf document is taken down as a copy the project owns, and the shelf keeps its own', async () => {
  const root = await context()
  try {
    await mkdir(path.join(root, 'shelf/rules'))
    await writeFile(path.join(root, 'shelf/rules/retention.md'), '# Retention\n\nSeven years.\n')
    await writeFile(path.join(root, 'shelf/scan.pdf'), 'not a document')

    const taken = await takeDown(root, 'review', 'shelf/rules/retention.md')
    assert.deepEqual([taken.file, taken.text, taken.drafts], ['retention.md', '# Retention\n\nSeven years.\n', ['policy.md', 'retention.md']])
    assert.equal(await readFile(path.join(root, 'shelf/rules/retention.md'), 'utf8'), '# Retention\n\nSeven years.\n')

    // A draft of that name is never written over. Only a document of the shelf is taken down.
    await assert.rejects(takeDown(root, 'review', 'shelf/rules/retention.md'), /already in this project/)
    await assert.rejects(takeDown(root, 'review', 'projects/review/draft/policy.md'), /Only a document of the shelf/)
    await assert.rejects(takeDown(root, 'review', 'shelf/scan.pdf'), /not a document/)
    await assert.rejects(takeDown(root, 'review', 'shelf/../projects/review/draft/policy.md'), /not a file of this context/)
    await assert.rejects(takeDown(root, 'nowhere', 'shelf/rules/retention.md'), /not in this context/)
    assert.equal((await readProject(root, 'review', 'policy.md')).drafts.length, 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
