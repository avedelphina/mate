import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { copyFolder, copySource, listShelf, noteSource, publish, pullIn, readProject, takeDown } from '../src/main/context.ts'
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

test('a document is pulled out of a dropbox into the drafts, and is in the dropbox no more', async () => {
  const root = await context()
  try {
    await mkdir(path.join(root, 'projects/review/dropbox'))
    await mkdir(path.join(root, 'projects/sibling/dropbox'), { recursive: true })
    await mkdir(path.join(root, 'dropbox'))
    await writeFile(path.join(root, 'projects/review/dropbox/letter.md'), '# Letter\n')
    await writeFile(path.join(root, 'projects/review/dropbox/policy.md'), 'Another policy.\n')
    await writeFile(path.join(root, 'projects/review/dropbox/scan.pdf'), 'pdf')
    await writeFile(path.join(root, 'projects/sibling/dropbox/theirs.md'), 'Theirs.\n')
    await writeFile(path.join(root, 'dropbox/for-all.md'), 'For all.\n')

    const pulled = await pullIn(root, 'review', 'projects/review/dropbox/letter.md')
    assert.deepEqual([pulled.file, pulled.text], ['letter.md', '# Letter\n'])
    assert.deepEqual(await readdir(path.join(root, 'projects/review/dropbox')), ['policy.md', 'scan.pdf'])
    // The dropbox of the whole context is pulled from too.
    assert.equal((await pullIn(root, 'review', 'dropbox/for-all.md')).file, 'for-all.md')
    assert.deepEqual(await readdir(path.join(root, 'dropbox')), [])

    // A draft of that name is there: the file stays in the dropbox. Another project's dropbox is not this one's.
    await assert.rejects(pullIn(root, 'review', 'projects/review/dropbox/policy.md'), /already in this project/)
    assert.equal(await readFile(path.join(root, 'projects/review/dropbox/policy.md'), 'utf8'), 'Another policy.\n')
    await assert.rejects(pullIn(root, 'review', 'projects/sibling/dropbox/theirs.md'), /Only a file of a dropbox/)
    await assert.rejects(pullIn(root, 'review', 'shelf/x.md'), /Only a file of a dropbox/)
    await assert.rejects(pullIn(root, 'review', 'projects/review/dropbox/scan.pdf'), /not a document Mate can open/)
    await assert.rejects(pullIn(root, 'review', 'dropbox/../shelf/x.md'), /not a file of this context/)
    // A note about a file that was left outside is the exit that file took. It is not made a draft.
    await writeFile(path.join(root, 'projects/review/dropbox/contract.pdf.source.md'), '# contract.pdf\n')
    await assert.rejects(pullIn(root, 'review', 'projects/review/dropbox/contract.pdf.source.md'), /stays in the dropbox/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a file outside the context is noted by where it lies, or copied in when it is a document', async () => {
  const root = await context()
  const outside = `${root}-outside`
  try {
    await mkdir(outside)
    await writeFile(path.join(outside, 'contract.pdf'), 'x'.repeat(3000))
    await writeFile(path.join(outside, 'memo.md'), '# Memo\n')

    // Left outside: the dropbox gets a note with the path, and nothing of what is in the file.
    const note = await noteSource(root, 'review', path.join(outside, 'contract.pdf'))
    assert.equal(note, 'projects/review/dropbox/contract.pdf.source.md')
    const text = await readFile(path.join(root, note), 'utf8')
    assert.match(text, /^# contract\.pdf\n\nThis file is not in the context\./)
    assert.ok(text.includes(`\`${path.join(outside, 'contract.pdf')}\``))
    assert.match(text, /3 KB, last changed \d{4}-\d\d-\d\d\. Noted \d{4}-\d\d-\d\d\./)
    assert.equal(text.includes('xxx'), false)
    // The note is a document of the project: a search finds the file by its name.
    assert.deepEqual([...new Set(searchIndex(await refreshIndex(root), 'contract').map((hit) => `${hit.kind} ${hit.path}`))], [`material ${note}`])
    await assert.rejects(noteSource(root, 'review', path.join(outside, 'contract.pdf')), /already noted/)
    for (const bad of ['relative.pdf', outside, path.join(outside, 'missing.pdf')]) await assert.rejects(noteSource(root, 'review', bad), /not a file on this computer/)

    // Copied in: only a document, and never over a draft that is there.
    const copied = await copySource(root, 'review', path.join(outside, 'memo.md'))
    assert.deepEqual([copied.file, copied.text], ['memo.md', '# Memo\n'])
    assert.equal(await readFile(path.join(outside, 'memo.md'), 'utf8'), '# Memo\n')
    await assert.rejects(copySource(root, 'review', path.join(outside, 'memo.md')), /already in this project/)
    await assert.rejects(copySource(root, 'review', path.join(outside, 'contract.pdf')), /not a document Mate can open/)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test('a folder from outside is copied into a project whole, with its folders, as material', async () => {
  const root = await context()
  const outside = `${root}-papers`
  try {
    await mkdir(path.join(outside, 'cz/2024'), { recursive: true })
    await mkdir(path.join(outside, '.git'))
    await writeFile(path.join(outside, 'cz/2024/zakon.pdf'), 'pdf')
    await writeFile(path.join(outside, 'cz/notes.md'), '# Poznámky\n')
    await writeFile(path.join(outside, '.git/config'), '[core]\n')
    await writeFile(path.join(outside, '.DS_Store'), '')
    await symlink('/etc/hosts', path.join(outside, 'hosts'))

    assert.equal(await copyFolder(root, 'review', outside), `projects/review/${path.basename(outside)}`)
    const copied = path.join(root, 'projects/review', path.basename(outside))
    assert.deepEqual((await readdir(copied, { recursive: true })).sort(), ['cz', 'cz/2024', 'cz/2024/zakon.pdf', 'cz/notes.md'])
    // It is material: the project keeps it where it was put, and a search finds it.
    assert.deepEqual([...new Set(searchIndex(await refreshIndex(root), 'Poznámky').map((hit) => `${hit.kind} ${hit.path}`))], [
      `material projects/review/${path.basename(outside)}/cz/notes.md`
    ])

    await assert.rejects(copyFolder(root, 'review', outside), /already in this project/)
    await assert.rejects(copyFolder(root, 'review', path.join(outside, 'cz/notes.md')), /not a folder/)
    await assert.rejects(copyFolder(root, 'review', 'cz'), /not a folder/)
    await assert.rejects(copyFolder(root, 'review', path.join(root, 'shelf')), /in this context already/)
    await assert.rejects(copyFolder(root, 'review', path.dirname(root)), /cannot be copied into itself/)
    await mkdir(path.join(outside, 'draft'))
    await assert.rejects(copyFolder(root, 'review', path.join(outside, 'draft')), /keeps draft\/ for itself/)
    await assert.rejects(copyFolder(root, 'review', path.join(outside, '.git')), /hidden/)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})
