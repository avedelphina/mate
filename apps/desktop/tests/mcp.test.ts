import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { readContextFile } from '../src/main/context.ts'
import { startMcp, type Binding } from '../src/main/mcp.ts'
import { meaningRuns, refreshMeaning } from '../src/main/meaning.ts'
import { refreshIndex } from '../src/main/contextIndex.ts'
import { loadSession, ownSession, sendMessage, startSession } from '../src/main/sessions.ts'
import { isPrivate, movePrivacy, setOpenedToEndpoint, setPrivate } from '../src/main/trust.ts'
import { parseComments } from '../src/shared/comments.ts'

// No test here asks the Ollama of the computer it runs on. One that needs a model puts a stand-in in.
meaningRuns.missing = async () => 'There is no model in the tests.'

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
    assert.match((await call('mate_search', { query: 'public data' })).text, /^By words:\n\[shelf: the current reference\] shelf\/classification\.md:/)
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

test('an agent Mate started gets a door that only reads, and searches there by meaning as well as by words', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-guest-'))
  await mkdir(path.join(root, 'shelf'), { recursive: true })
  await mkdir(path.join(root, 'projects/review/draft'), { recursive: true })
  await writeFile(path.join(root, 'shelf/records.md'), '# Záznamy\n\nDůvěrné záznamy se uchovávají deset let.\n')
  await writeFile(path.join(root, 'projects/review/draft/document.md'), '# Draft\n\nText.\n')
  const session = await startSession(root, 'review', 'hermes')
  const guests = new Map<string, Binding>([['guest-token', { contextDir: root, project: 'review', id: session.id }]])
  const door = await startMcp({ port: 0, token: 'secret', binding: () => null, changed: () => {}, guest: (token) => guests.get(token) ?? null })
  // A stand-in for the model: one dimension for records, in either language.
  const runs = { ...meaningRuns }
  meaningRuns.missing = async () => null
  meaningRuns.embed = async (texts) => texts.map((text) => [/record|záznam/i.test(text) ? 1 : 0, 0.1])
  const post = async (body: unknown, token = 'guest-token') =>
    (await fetch(`http://127.0.0.1:${door.port}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) })) as Response
  const call = async (name: string, args: Record<string, string> = {}) => {
    const { result } = (await (await post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).json()) as {
      result: { content: { text: string }[]; isError?: boolean }
    }
    return { text: result.content[0].text, failed: result.isError === true }
  }
  try {
    // Its token leads to its own session, and to the tools that read. Any other token leads nowhere.
    assert.equal((await post({}, 'some-other-token')).status, 401)
    const listed = (await (await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).json()) as { result: { tools: { name: string }[] } }
    assert.deepEqual(listed.result.tools.map((each) => each.name), ['mate_project', 'mate_read', 'mate_search', 'mate_comments'])
    assert.deepEqual(await call('mate_write', { path: 'projects/review/draft/document.md', text: 'Mine.' }), {
      text: 'This door only reads. Write with your own tools.',
      failed: true
    })
    assert.equal(await readFile(path.join(root, 'projects/review/draft/document.md'), 'utf8'), '# Draft\n\nText.\n')

    // An English question with no word of the Czech passage finds it by meaning, whole, with its place.
    await refreshMeaning(root, await refreshIndex(root), meaningRuns.embed)
    const found = await call('mate_search', { query: 'how long do we keep records' })
    assert.equal(found.failed, false)
    assert.match(found.text, /^Nothing matches by words\.\n\nClose in meaning, the closest first:\n\n\[shelf: the current reference\] shelf\/records\.md, characters 0 to \d+:\n# Záznamy\n\nDůvěrné záznamy se uchovávají deset let\.$/)
    // What it did is not written into the session: the agent reports its own steps.
    assert.equal((await loadSession(root, 'review', session.id)).messages.length, 0)
  } finally {
    Object.assign(meaningRuns, runs)
    door.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('in a private context no agent starts, none is told anything, and the door gives nothing more', async () => {
  // Its real path, as main has it when a context is renamed: the temporary folder is behind a link on a Mac.
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'mate-private-')))
  await mkdir(path.join(root, 'projects/review/draft'), { recursive: true })
  await writeFile(path.join(root, 'projects/review/draft/document.md'), '# Draft\n\nConfidential text.\n')
  // An agent that came in before the context was made private.
  const session = await startSession(root, 'review', 'mcp')
  const bound: Binding = { contextDir: root, project: 'review', id: session.id }
  const door = await startMcp({ port: 0, token: 'secret', binding: () => bound, changed: () => {} })
  const read = async () => {
    const response = await fetch(`http://127.0.0.1:${door.port}/mcp`, {
      method: 'POST',
      headers: { authorization: 'Bearer secret' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'mate_read', arguments: { path: 'projects/review/draft/document.md' } } })
    })
    return ((await response.json()) as { result: { content: { text: string }[] } }).result.content[0].text
  }
  try {
    assert.match(await read(), /Confidential text/)
    setPrivate(root, true)
    assert.equal(isPrivate(root), true)
    assert.match(await read(), /^This context is private\./)
    await assert.rejects(startSession(root, 'review', 'claude'), /This context is private/)
    await assert.rejects(startSession(root, 'review', 'hermes', 'some-host'), /This context is private/)
    await assert.rejects(sendMessage(root, 'review', session.id, 'Read the draft.', false, () => {}), /This context is private/)

    // Opened to the reader's endpoint, it lets in Hermes on that endpoint, and still no other agent, nor the door.
    await assert.rejects(startSession(root, 'review', 'private'), /This context is private/)
    setOpenedToEndpoint(root, true)
    assert.equal((await startSession(root, 'review', 'private')).agent, 'private')
    await assert.rejects(startSession(root, 'review', 'claude'), /Only Hermes on your own endpoint works in it/)
    await assert.rejects(sendMessage(root, 'review', session.id, 'Read the draft.', false, () => {}), /Only Hermes on your own endpoint/)
    assert.match(await read(), /^This context is private\./)
    setOpenedToEndpoint(root, false)

    // Renamed, it stays private, and the name it had is not private any more.
    const renamed = `${root}-renamed`
    await rename(root, renamed)
    movePrivacy(root, renamed)
    assert.deepEqual([isPrivate(renamed), isPrivate(root)], [true, false])
    await rename(renamed, root)
    movePrivacy(renamed, root)

    setPrivate(root, false)
    assert.match(await read(), /Confidential text/)
  } finally {
    setPrivate(root, false)
    door.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('the door for the reader\'s own agent leads to a session made for it, and to no other', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-own-'))
  try {
    await mkdir(path.join(root, 'projects/review/draft'), { recursive: true })
    await writeFile(path.join(root, 'projects/review/draft/document.md'), '# Draft\n')
    const own = await startSession(root, 'review', 'mcp')
    const other = await startSession(root, 'review', 'hermes')
    assert.equal((await ownSession(root, 'review', own.id)).id, own.id)
    await assert.rejects(ownSession(root, 'review', other.id), /not one for your own agent/)
    await assert.rejects(ownSession(root, 'review', 'no-such-session'))
    await assert.rejects(ownSession(root, 'review', '../../../etc'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
