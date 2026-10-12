import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { AGENTS, SSH, listAgents, sshArgs } from '../src/main/agents.ts'
import { changesSince, put, takeSnapshot } from '../src/main/guard.ts'
import { listSessions, revertChange, sendMessage, settleHeld, startSession } from '../src/main/sessions.ts'

async function context(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-agents-'))
  const write = async (relative: string, text: string) => {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true })
    await writeFile(path.join(root, relative), text)
  }
  await write('shelf/classification.md', 'Shelf text.\n')
  await write('projects/review/draft/document.md', 'Draft text.\n')
  await write('projects/review/intents.md', 'Stay honest.\n')
  await write('projects/sibling/draft/notes.md', 'Sibling text.\n')
  return root
}

test('each agent is asked to plan first, and its output is read as the same events', () => {
  const turn = { cwd: '/c/projects/p', contextDir: '/c', resume: null, mayWrite: false }
  assert.deepEqual(AGENTS.claude.args(turn).slice(4, 6), ['--permission-mode', 'plan'])
  assert.ok(AGENTS.claude.args({ ...turn, mayWrite: true, resume: 'abc' }).join(' ').includes('acceptEdits'))
  assert.deepEqual(AGENTS.claude.args({ ...turn, resume: 'abc' }).slice(-2), ['--resume', 'abc'])
  assert.ok(AGENTS.codex.args(turn).includes('read-only'))
  assert.deepEqual(AGENTS.codex.args({ ...turn, mayWrite: true, resume: 'abc' }).slice(-3), ['resume', 'abc', '-'])
  assert.deepEqual(AGENTS.hermes.args(turn).slice(-2), ['-t', 'file'])

  // Lines as the three tools print them.
  assert.deepEqual(AGENTS.claude.read('{"type":"system","subtype":"init","session_id":"151100d5"}'), [{ type: 'session', id: '151100d5' }])
  assert.deepEqual(
    AGENTS.claude.read(
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/c/draft/note.md"}},{"type":"text","text":"It says so."}]}}'
    ),
    [
      { type: 'tool', name: 'Read', detail: '/c/draft/note.md' },
      { type: 'text', text: 'It says so.\n\n' }
    ]
  )
  assert.deepEqual(AGENTS.hermes.read('{"type": "text", "text": "raft", "timestamp": 1}'), [{ type: 'text', text: 'raft' }])
  assert.deepEqual(AGENTS.hermes.read('{"type": "tool_use", "name": "read_file", "input": {"path": "draft/note.md"}}'), [
    { type: 'tool', name: 'read_file', detail: 'draft/note.md' }
  ])
  assert.deepEqual(AGENTS.hermes.read('{"type": "result", "session_id": "s", "exit_code": 0, "text": "Done."}'), [])
  assert.deepEqual(AGENTS.codex.read('{"id":"0","msg":{"type":"agent_message","message":"Here is a plan."}}'), [
    { type: 'text', text: 'Here is a plan.\n\n' }
  ])
  assert.deepEqual(AGENTS.codex.read('{"id":"0","msg":{"type":"error","message":"last status: 401 Unauthorized"}}'), [
    { type: 'error', message: 'last status: 401 Unauthorized' }
  ])
  assert.deepEqual(AGENTS.hermes.read('session_id: 20261012_161941_75fc3d'), [])
})

test('the guard sees what changed in the folder, and can put it back', async () => {
  const root = await context()
  try {
    const before = await takeSnapshot(root)
    await writeFile(path.join(root, 'shelf/classification.md'), 'Changed.\n')
    await writeFile(path.join(root, 'projects/review/new.md'), 'New.\n')
    await rm(path.join(root, 'projects/sibling/draft/notes.md'))
    await mkdir(path.join(root, '.git/hooks'), { recursive: true })
    await writeFile(path.join(root, '.git/hooks/pre-commit'), 'echo run later\n')
    await mkdir(path.join(root, '.sessions/x'), { recursive: true })
    await writeFile(path.join(root, '.sessions/x/session.json'), '{}')

    const changes = await changesSince(root, before)
    assert.deepEqual(changes.map((change) => [change.path, change.before === null, change.after === null]), [
      ['.git/hooks/pre-commit', true, false],
      ['projects/review/new.md', true, false],
      ['projects/sibling/draft/notes.md', false, true],
      ['shelf/classification.md', false, false]
    ])
    for (const change of changes) await put(root, change.path, change.before)
    assert.deepEqual(await changesSince(root, before), [])
    assert.equal(existsSync(path.join(root, '.git/hooks/pre-commit')), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an agent may not write before its plan is approved, nor outside the project after', { skip: process.platform === 'win32' }, async () => {
  const root = await context()
  const command = AGENTS.hermes.command
  try {
    // A stand-in for an agent that keeps no rule: every turn it edits the draft and the shelf.
    const stub = path.join(root, '..', `${path.basename(root)}-agent.mjs`)
    await writeFile(
      stub,
      `#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
const prompt = readFileSync(0, 'utf8')
appendFileSync(${JSON.stringify(path.join(root, '..', path.basename(root) + '-asked.txt'))}, JSON.stringify({ args: process.argv.slice(2), prompt }) + '\\n')
appendFileSync('draft/document.md', 'Agent line.\\n')
writeFileSync('../../shelf/classification.md', 'Agent shelf.\\n')
console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }))
console.log(JSON.stringify({ type: 'tool_use', name: 'write_file', input: { path: 'draft/document.md' } }))
console.log(JSON.stringify({ type: 'text', text: 'Here is ' }))
console.log(JSON.stringify({ type: 'text', text: 'my plan.' }))
console.log('session_id: s1')
`
    )
    await chmod(stub, 0o755)
    AGENTS.hermes.command = stub
    const asked = async () =>
      (await readFile(path.join(root, '..', path.basename(root) + '-asked.txt'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
    const draft = () => readFile(path.join(root, 'projects/review/draft/document.md'), 'utf8')
    const shelf = () => readFile(path.join(root, 'shelf/classification.md'), 'utf8')

    const session = await startSession(root, 'review', 'hermes')
    const seen: boolean[] = []
    const first = await sendMessage(root, 'review', session.id, 'Tighten the draft.', false, (now) => seen.push(now.running))
    await assert.rejects(sendMessage(root, 'review', session.id, 'Again.', false, () => {}), /still answering/)
    const planned = await first.finished

    // The plan was not approved: both files are as they were, and both changes wait.
    assert.equal(await draft(), 'Draft text.\n')
    assert.equal(await shelf(), 'Shelf text.\n')
    assert.deepEqual(planned.held.map((held) => [held.path, held.state]), [
      ['projects/review/draft/document.md', 'waiting'],
      ['shelf/classification.md', 'waiting']
    ])
    assert.deepEqual(planned.messages.map((message) => message.role), ['you', 'agent', 'mate'])
    assert.equal(planned.messages[1].text, 'Here is my plan.')
    assert.deepEqual(planned.messages[1].tools, ['write_file draft/document.md'])
    assert.equal(planned.agentSession, 's1')
    assert.equal(seen.at(-1), false)
    assert.match((await asked())[0].prompt, /Propose a plan first[\s\S]*classification\.md[\s\S]*sibling[\s\S]*Stay honest\.[\s\S]*not approved yet[\s\S]*Tighten the draft\./)

    // Approved. The draft is the agent's to change now. The shelf still is not.
    const approved = await (await sendMessage(root, 'review', session.id, '', true, () => {})).finished
    assert.equal(await draft(), 'Draft text.\nAgent line.\n')
    assert.equal(await shelf(), 'Shelf text.\n')
    assert.deepEqual(approved.changes, [{ path: 'projects/review/draft/document.md', backup: '0', reverted: false }])
    assert.equal(approved.held.length, 3)
    const second = (await asked())[1]
    assert.deepEqual(second.args.slice(-2), ['--resume', 's1'])
    assert.match(second.prompt, /^\[The plan is approved\./)
    assert.doesNotMatch(second.prompt, /Propose a plan first/)

    // The reader approves the shelf file, once. Then takes the draft back.
    const through = await settleHeld(root, 'review', session.id, 2, true)
    assert.equal(await shelf(), 'Agent shelf.\n')
    assert.equal(through.held[2].state, 'approved')
    await assert.rejects(settleHeld(root, 'review', session.id, 2, true), /not waiting/)
    assert.equal((await settleHeld(root, 'review', session.id, 1, false)).held[1].state, 'discarded')

    const reverted = await revertChange(root, 'review', session.id, 0)
    assert.equal(await draft(), 'Draft text.\n')
    assert.equal(reverted.changes[0].reverted, true)
    await revertChange(root, 'review', session.id, 1)
    assert.equal(await shelf(), 'Shelf text.\n')

    // It is all in the context, and out of its repository.
    const [stored] = await listSessions(root, 'review')
    assert.equal(stored.id, session.id)
    assert.equal(stored.running, false)
    assert.equal(await readFile(path.join(root, '.sessions/.gitignore'), 'utf8'), '*\n')
    await assert.rejects(sendMessage(root, '../..', session.id, 'Out.', false, () => {}), /leaves the context/)
  } finally {
    AGENTS.hermes.command = command
    await rm(root, { recursive: true, force: true })
    await rm(path.join(root, '..', `${path.basename(root)}-agent.mjs`), { force: true })
    await rm(path.join(root, '..', `${path.basename(root)}-asked.txt`), { force: true })
  }
})

test('an agent on another machine is sent the files, and what it asks to change keeps the same rules', { skip: process.platform === 'win32' }, async () => {
  const root = await context()
  const command = SSH.command
  const stub = path.join(root, '..', `${path.basename(root)}-ssh.mjs`)
  const log = path.join(root, '..', `${path.basename(root)}-ssh.txt`)
  try {
    assert.deepEqual(sshArgs('hermes.ocean', 'hermes', ["it's"]).slice(-4), ['hermes.ocean', '--', "'hermes'", `'it'\\''s'`])
    assert.throws(() => sshArgs('-oProxyCommand=evil', 'hermes', []), /not a host/)
    assert.equal(listAgents().filter((agent) => agent.host !== null).every((agent) => agent.kind === 'hermes'), true)
    await assert.rejects(startSession(root, 'review', 'claude', 'hermes.ocean'), /another machine/)

    // A stand-in for ssh. It never touches the folder: it only says what it wants changed.
    await writeFile(
      stub,
      `#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs'
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args: process.argv.slice(2), prompt: readFileSync(0, 'utf8') }) + '\\n')
console.error('\\nsession_id: r1')
console.log('I would change two files.\\n<mate-file path="projects/review/draft/document.md">\\nDraft text, tightened.\\n</mate-file>')
console.log('<mate-file path="shelf/classification.md">\\nShelf, rewritten.\\n</mate-file>\\n<mate-file path="../outside.md">\\nNo.\\n</mate-file>')
`
    )
    await chmod(stub, 0o755)
    SSH.command = stub
    const asked = async () => (await readFile(log, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
    const draft = () => readFile(path.join(root, 'projects/review/draft/document.md'), 'utf8')
    const shelf = () => readFile(path.join(root, 'shelf/classification.md'), 'utf8')

    const session = await startSession(root, 'review', 'hermes', 'hermes.ocean')
    const planned = await (await sendMessage(root, 'review', session.id, 'Tighten the draft.', false, () => {})).finished
    // Not approved: nothing is written. Both changes wait, and the one outside the context is refused.
    assert.equal(await draft(), 'Draft text.\n')
    assert.equal(await shelf(), 'Shelf text.\n')
    assert.deepEqual(planned.held.map((held) => held.path), ['projects/review/draft/document.md', 'shelf/classification.md'])
    assert.match(planned.messages[1].text, /^I would change two files\.\n\*\(new text for `projects\/review\/draft\/document\.md`\)\*/)
    assert.match(planned.messages.at(-1)!.text, /will not write: \.\.\/outside\.md/)

    const [first] = await asked()
    assert.deepEqual(first.args.slice(4, 6), ['hermes.ocean', '--'])
    assert.ok(first.args.includes("'todo'") && first.args.includes("'-Q'"))
    assert.match(first.prompt, /You cannot open files[\s\S]*kind="proposal of project review">\nDraft text\.\n<\/file>[\s\S]*<file path="shelf\/classification\.md" kind="shelf">\nShelf text\.\n<\/file>/)

    // Approved: the project file is written here, with a copy for Revert. The shelf still waits.
    const approved = await (await sendMessage(root, 'review', session.id, '', true, () => {})).finished
    assert.equal(await draft(), 'Draft text, tightened.\n')
    assert.equal(await shelf(), 'Shelf text.\n')
    assert.deepEqual(approved.changes, [{ path: 'projects/review/draft/document.md', backup: '0', reverted: false }])
    const second = (await asked())[1]
    assert.ok(second.args.includes("'r1'"))
    // Only what changed is sent again, and nothing had.
    assert.doesNotMatch(second.prompt, /<file path=/)
    assert.equal((await revertChange(root, 'review', session.id, 0)).changes[0].reverted, true)
    assert.equal(await draft(), 'Draft text.\n')
  } finally {
    SSH.command = command
    await rm(root, { recursive: true, force: true })
    await rm(stub, { force: true })
    await rm(log, { force: true })
  }
})
