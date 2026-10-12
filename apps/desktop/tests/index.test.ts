import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
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
  assert.deepEqual(placeOf('projects/review/draft/deep/x.md'), { kind: 'project', project: 'review' })
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
