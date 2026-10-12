import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { readContextFile } from '../src/main/context.ts'
import { startMcp, type Binding } from '../src/main/mcp.ts'
import { loadSession, sendMessage, startSession } from '../src/main/sessions.ts'
import { parseComments } from '../src/shared/comments.ts'

test("an agent the reader runs comes in over MCP, and keeps the same rules", async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-mcp-'))
  const write = async (relative: string, text: string) => {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true })
    await writeFile(path.join(root, relative), text)
  }
  await write('shelf/classification.md', '# Classification\n\nPublic data may leave.\n')
  await write('projects/review/draft/document.md', '# Working copy\n\nPublic data may leave after review.\n')
  await write('projects/sibling/draft/notes.md', 'Sibling text.\n')

  let bound: Binding | null = null
  let told = 0
  const door = await startMcp({ port: 0, token: 'secret', binding: () => bound, changed: () => (told += 1) })
  const post = (body: unknown, headers: Record<string, string> = { authorization: 'Bearer secret' }) =>
    fetch(`http://127.0.0.1:${door.port}/mcp`, { method: 'POST', headers, body: JSON.stringify(body) })
  let next = 0
  const call = async (name: string, args: Record<string, string> = {}) => {
    const response = await post({ jsonrpc: '2.0', id: ++next, method: 'tools/call', params: { name, arguments: args } })
    const { result } = (await response.json()) as { result: { content: { text: string }[]; isError?: boolean } }
    return { text: result.content[0].text, failed: result.isError === true }
  }
  const draft = () => readFile(path.join(root, 'projects/review/draft/document.md'), 'utf8')
  const shelf = () => readFile(path.join(root, 'shelf/classification.md'), 'utf8')

  try {
    // No token, a wrong one, or a web page: no way in.
    assert.equal((await post({}, {})).status, 401)
    assert.equal((await post({}, { authorization: 'Bearer wrong!' })).status, 401)
    assert.equal((await post({}, { authorization: 'Bearer secret', origin: 'https://example.org' })).status, 403)
    assert.equal((await fetch(`http://127.0.0.1:${door.port}/mcp`, { headers: { authorization: 'Bearer secret' } })).status, 405)

    const hello = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'tester' } } })
    assert.equal(((await hello.json()) as { result: { serverInfo: { name: string } } }).result.serverInfo.name, 'mate')
    assert.equal((await post({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202)
    const listed = (await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()) as { result: { tools: { name: string }[] } }
    assert.ok(listed.result.tools.some((tool) => tool.name === 'mate_write'))

    // The door leads nowhere until the reader opens a session for it.
    assert.match((await call('mate_project')).text, /No project is open for you/)
    const session = await startSession(root, 'review', 'mcp')
    bound = { contextDir: root, project: 'review', id: session.id }

    const project = await call('mate_project')
    assert.match(project.text, /Propose a plan first[\s\S]*No plan is approved yet[\s\S]*shelf\/classification\.md \(shelf: the current reference\)/)
    assert.match(project.text, /projects\/review\/draft\/document\.md \(proposal: a draft under review of project review\)/)
    assert.match((await call('mate_read', { path: 'shelf/classification.md' })).text, /^\[shelf: the current reference\] shelf\/classification\.md\n\n# Classification/)
    assert.match((await call('mate_search', { query: 'public data' })).text, /^\[shelf: the current reference\] shelf\/classification\.md:/)
    for (const path of ['../outside.md', '.sessions/x', '/etc/passwd']) assert.equal((await call('mate_read', { path })).failed, true)

    // A link in the context is read only while what it points at is in the context too.
    await writeFile(`${root}-outside.md`, 'Not of this context.\n')
    await symlink(`${root}-outside.md`, path.join(root, 'shelf/leak.md'))
    await symlink(path.join(root, 'shelf/classification.md'), path.join(root, 'shelf/also.md'))
    assert.match((await call('mate_read', { path: 'shelf/leak.md' })).text, /leaves the context/)
    assert.match((await call('mate_comments', { path: 'shelf/leak.md' })).text, /leaves the context/)
    await assert.rejects(readContextFile(root, 'shelf/leak.md'), /leaves the context/)
    assert.match((await call('mate_read', { path: 'shelf/also.md' })).text, /# Classification/)
    assert.equal((await readContextFile(root, 'shelf/also.md')).text, '# Classification\n\nPublic data may leave.\n')
    // Only a document is read. The session file beside it is not one.
    await write('projects/review/notes.txt', 'Not a document.\n')
    assert.match((await call('mate_read', { path: 'projects/review/notes.txt' })).text, /not a document/)

    // Before the plan is approved, a write is held, wherever it is. A comment is a comment.
    assert.match((await call('mate_write', { path: 'projects/review/draft/document.md', text: 'Rewritten.\n' })).text, /Not written/)
    assert.equal(await draft(), '# Working copy\n\nPublic data may leave after review.\n')
    await call('mate_comment', { path: 'projects/review/draft/document.md', passage: 'after review', note: 'The shelf does not say this.', replacement: 'at once' })
    const [comment] = parseComments(await draft())
    assert.deepEqual([comment.author, comment.suggestion], ['tester', 'at once'])
    assert.match((await call('mate_comments', { path: 'projects/review/draft/document.md' })).text, /"replacement": "at once"/)
    assert.equal((await call('mate_comment', { path: 'shelf/classification.md', passage: 'Public', note: 'No.' })).failed, true)
    assert.equal((await call('mate_reply', { path: 'projects/review/draft/document.md', id: '1', text: 'See the shelf.' })).failed, false)

    assert.match((await call('mate_plan', { plan: 'Bring the draft in line with the shelf.' })).text, /with the reviewer/)
    assert.match((await call('mate_status')).text, /not approved[\s\S]*Held for the reviewer: projects\/review\/draft\/document\.md/)

    // The reader approves. It is a message in the session, and no process is started for it.
    await (await sendMessage(root, 'review', session.id, 'Keep the heading.', true, () => {})).finished
    assert.match((await call('mate_status')).text, /plan is approved[\s\S]*Keep the heading\./)
    const before = await draft()
    assert.match((await call('mate_write', { path: 'projects/review/draft/document.md', text: before.replace('after review', 'at once') })).text, /^Written/)
    assert.match(await draft(), /may leave at once\./)
    assert.match((await call('mate_write', { path: 'shelf/classification.md', text: 'Mine now.\n' })).text, /Not written/)
    assert.equal(await shelf(), '# Classification\n\nPublic data may leave.\n')

    const stored = await loadSession(root, 'review', session.id)
    assert.deepEqual(stored.changes.map((change) => change.path), ['projects/review/draft/document.md'])
    assert.deepEqual(stored.held.map((held) => held.path), ['projects/review/draft/document.md', 'shelf/classification.md'])
    assert.ok(stored.messages.some((message) => message.role === 'agent' && message.text.startsWith('Bring the draft')))
    assert.ok(stored.messages.some((message) => message.tools.includes('mate_read shelf/classification.md')))
    assert.ok(told > 10)
  } finally {
    door.close()
    await rm(root, { recursive: true, force: true })
    await rm(`${root}-outside.md`, { force: true })
  }
})
