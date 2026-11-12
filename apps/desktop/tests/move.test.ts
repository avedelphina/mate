import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { addComment, listProjects, moveProject, readCommented, repositoriesOf } from '../src/main/context.ts'
import { moveConversations, saveSession } from '../src/main/sessions.ts'

test('a project moved into another is its folder there: its private layer follows, and its repositories are removed', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-'))
  try {
    const a = path.join(root, 'projects/A')
    await mkdir(path.join(a, 'draft/sub/.git'), { recursive: true })
    await mkdir(path.join(a, '.git'))
    await writeFile(path.join(a, '.git/config'), '[remote "origin"]\n\turl = https://git.example/a.git\n')
    await writeFile(path.join(a, 'draft/x.md'), '# X\n\nAlpha stays.\n')
    await writeFile(path.join(a, 'draft/sub/.git/config'), '')
    await mkdir(path.join(root, 'projects/B/draft'), { recursive: true })
    await writeFile(path.join(root, 'projects/B/draft/b.md'), '# B\n')

    await addComment(root, 'A', 'draft/x.md', 'Alpha stays.', 'Why?', 'you')
    await mkdir(path.join(root, '.mate/projects/A/panes'), { recursive: true })
    await writeFile(path.join(root, '.mate/projects/A/panes/t.md'), '- [ ] one\n')
    await mkdir(path.join(root, '.indexes/text/projects/A'), { recursive: true })
    await writeFile(path.join(root, '.indexes/text/projects/A/doc.pdf.txt'), 'text')

    // The window asks what goes with it, from the remote and the repositories in it. Nothing is run.
    assert.deepEqual(await repositoriesOf(root, 'A'), { remote: 'https://git.example/a.git', inside: 2 })

    assert.deepEqual(await moveProject(root, 'A', 'B'), { made: 'B/A', removed: 2 })
    assert.deepEqual(await listProjects(root), ['B'], 'A is no longer a project')
    assert.equal(existsSync(a), false)
    // Its files keep their paths, and no repository is left in them.
    assert.equal(await readFile(path.join(root, 'projects/B/A/draft/x.md'), 'utf8'), '# X\n\nAlpha stays.\n')
    assert.equal(existsSync(path.join(root, 'projects/B/A/.git')), false)
    assert.equal(existsSync(path.join(root, 'projects/B/A/draft/sub/.git')), false)
    // The private comment, the pane and the text twin moved with it, under the same path.
    assert.match(await readFile(path.join(root, '.mate/projects/B/A/draft/x.md.comments.md'), 'utf8'), /Why\?/)
    assert.equal(await readFile(path.join(root, '.mate/projects/B/A/panes/t.md'), 'utf8'), '- [ ] one\n')
    assert.equal(existsSync(path.join(root, '.mate/projects/A')), false)
    assert.equal(await readFile(path.join(root, '.indexes/text/projects/B/A/doc.pdf.txt'), 'utf8'), 'text')
    // Read the way an agent reads it, the comment is still there.
    assert.match(await readCommented(root, 'projects/B/A/draft/x.md'), /Why\?/)

    // A folder of that name in the target is not written over, and a project is not moved into itself.
    await mkdir(path.join(root, 'projects/C'))
    await mkdir(path.join(root, 'projects/C/B'))
    await assert.rejects(moveProject(root, 'B', 'C'), /already has a folder called B/)
    await assert.rejects(moveProject(root, 'B', 'B'), /into itself/)
    await assert.rejects(moveProject(root, 'missing', 'B'), /not in this context/)
    assert.equal((await readdir(path.join(root, 'projects'))).sort().join(), 'B,C')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the conversations of a moved project are listed with the project they are now in', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-'))
  try {
    await mkdir(path.join(root, 'projects/A'), { recursive: true })
    await mkdir(path.join(root, 'projects/B'), { recursive: true })
    const session = { id: 's1', project: 'A', created: '2026-11-12T10:00:00.000Z' } as unknown as Parameters<typeof saveSession>[1]
    await saveSession(root, session)
    assert.ok(existsSync(path.join(root, '.sessions/A/s1/session.json')))
    await moveConversations(root, 'A', 'B')
    assert.ok(existsSync(path.join(root, '.sessions/B/s1/session.json')))
    assert.equal(existsSync(path.join(root, '.sessions/A')), false)
    assert.equal(JSON.parse(await readFile(path.join(root, '.sessions/B/s1/session.json'), 'utf8')).project, 'B')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
