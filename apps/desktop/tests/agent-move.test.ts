import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { addComment, writeNote } from '../src/main/context.ts'
import { callTool, type Binding } from '../src/main/mcp.ts'
import { loadSession, revertChange, sendMessage, startSession, stopAllTurns } from '../src/main/sessions.ts'

test('an agent moves and deletes files of its own project, with their comments, and the reader can revert it', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-'))
  try {
    const draft = path.join(root, 'projects/review/draft')
    await mkdir(draft, { recursive: true })
    await writeFile(path.join(draft, 'a.md'), '# A\n\nAlpha stays.\n')
    await writeFile(path.join(draft, 'b.md'), '# B\n')
    await writeFile(path.join(root, 'projects/review/intents.md'), '# Intents\n')
    await mkdir(path.join(root, 'projects/sibling/draft'), { recursive: true })
    await writeFile(path.join(root, 'projects/sibling/draft/c.md'), '# C\n')
    await addComment(root, 'review', 'draft/a.md', 'Alpha stays.', 'Why?', 'you')
    await writeNote(root, 'review', 'draft/a.md', '', 'About A.\n')

    const session = await startSession(root, 'review', 'mcp')
    const binding: Binding = { contextDir: root, project: 'review', id: session.id }
    const run = (name: string, input: Record<string, string>) => callTool(binding, name, input, 'tester', () => {})

    // Before the plan is approved, nothing moves.
    await run('mate_plan', { plan: 'File the drafts.' })
    await assert.rejects(run('mate_move', { from: 'projects/review/draft/a.md', to: 'projects/review/draft/archive/a.md' }), /plan is not approved/)
    await (await sendMessage(root, 'review', session.id, 'Go.', true, () => {})).finished

    // Inside the project, with the comment and the note.
    assert.match(await run('mate_move', { from: 'projects/review/draft/a.md', to: 'projects/review/draft/archive/a.md' }), /^Moved/)
    assert.equal(existsSync(path.join(draft, 'a.md')), false)
    assert.equal(await readFile(path.join(draft, 'archive/a.md'), 'utf8'), '# A\n\nAlpha stays.\n')
    assert.equal(existsSync(path.join(root, '.mate/projects/review/draft/a.md.comments.md')), false)
    assert.match(await readFile(path.join(root, '.mate/projects/review/draft/archive/a.md.comments.md'), 'utf8'), /Why\?/)
    assert.equal(await readFile(path.join(root, '.mate/projects/review/draft/archive/a.md.notes.md'), 'utf8'), 'About A.\n')

    // Outside the project, and the steering files, are refused.
    await assert.rejects(run('mate_move', { from: 'projects/review/draft/b.md', to: 'projects/sibling/draft/b.md' }), /only files of your project/)
    await assert.rejects(run('mate_delete', { path: 'projects/sibling/draft/c.md' }), /only files of your project/)
    await assert.rejects(run('mate_delete', { path: 'projects/review/intents.md' }), /steer the project/)
    await assert.rejects(run('mate_move', { from: 'projects/review/draft/b.md', to: 'projects/review/draft/archive/a.md' }), /A file is there already/)

    // Delete, and the reader reverts it.
    assert.match(await run('mate_delete', { path: 'projects/review/draft/b.md' }), /^Deleted/)
    assert.equal(existsSync(path.join(draft, 'b.md')), false)
    const stored = await loadSession(root, 'review', session.id)
    const index = stored.changes.findIndex((change) => change.path === 'projects/review/draft/b.md')
    assert.ok(index >= 0, 'the deletion is in the session, to be reverted')
    await revertChange(root, 'review', session.id, index)
    assert.equal(await readFile(path.join(draft, 'b.md'), 'utf8'), '# B\n')
  } finally {
    stopAllTurns()
    await rm(root, { recursive: true, force: true })
  }
})
