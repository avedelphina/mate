import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { AGENTS, SSH, listAgents, sshArgs } from '../src/main/agents.ts'
import { changesSince, put, takeSnapshot } from '../src/main/guard.ts'
import { listSessions, loadSession, revertChange, sendMessage, settleHeld, startSession } from '../src/main/sessions.ts'
import { isTrusted, keepTrustIn, setTrusted } from '../src/main/trust.ts'

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
  const turn = { cwd: '/c/projects/p', contextDir: '/c', resume: null, mayWrite: false, trusted: false }
  assert.deepEqual(AGENTS.claude.args(turn).slice(4, 6), ['--permission-mode', 'plan'])
  assert.ok(AGENTS.claude.args({ ...turn, mayWrite: true, resume: 'abc' }).join(' ').includes('acceptEdits'))
  assert.deepEqual(AGENTS.claude.args({ ...turn, resume: 'abc' }).slice(-2), ['--resume', 'abc'])
  assert.ok(AGENTS.codex.args(turn).includes('read-only'))
  assert.deepEqual(AGENTS.codex.args({ ...turn, mayWrite: true, resume: 'abc' }).slice(-3), ['resume', 'abc', '-'])
  assert.deepEqual(AGENTS.hermes.args(turn).slice(-2), ['-t', 'file'])
  // In a context the reader trusts, Hermes is not cut down to file tools. The others are not changed by it.
  assert.equal(AGENTS.hermes.args({ ...turn, trusted: true }).includes('-t'), false)
  assert.deepEqual(AGENTS.claude.args({ ...turn, trusted: true }), AGENTS.claude.args(turn))
  assert.deepEqual(AGENTS.codex.args({ ...turn, trusted: true }), AGENTS.codex.args(turn))

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
    await mkdir(path.join(root, '.git'), { recursive: true })
    await writeFile(path.join(root, '.git/config'), '[core]\n\trepositoryformatversion = 0\n')
    const before = await takeSnapshot(root)
    await writeFile(path.join(root, 'shelf/classification.md'), 'Changed.\n')
    await writeFile(path.join(root, 'projects/review/new.md'), 'New.\n')
    await rm(path.join(root, 'projects/sibling/draft/notes.md'))
    await mkdir(path.join(root, '.git/hooks'), { recursive: true })
    await writeFile(path.join(root, '.git/hooks/pre-commit'), 'echo run later\n')
    // Pointing git at hooks elsewhere is a change like any other.
    await writeFile(path.join(root, '.git/config'), '[core]\n\thooksPath = elsewhere\n')
    await mkdir(path.join(root, '.sessions/x'), { recursive: true })
    await writeFile(path.join(root, '.sessions/x/session.json'), '{}')

    const changes = await changesSince(root, before)
    assert.deepEqual(changes.map((change) => [change.path, change.before === null, change.after === null]), [
      ['.git/config', false, false],
      ['.git/hooks/pre-commit', true, false],
      ['projects/review/new.md', true, false],
      ['projects/sibling/draft/notes.md', false, true],
      ['shelf/classification.md', false, false]
    ])
    for (const change of changes) await put(root, change.path, change.before)
    assert.deepEqual(await changesSince(root, before), [])
    assert.equal(existsSync(path.join(root, '.git/hooks/pre-commit')), false)
    assert.equal(await readFile(path.join(root, '.git/config'), 'utf8'), '[core]\n\trepositoryformatversion = 0\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a poisoned session file cannot make Revert or Approve write outside the context', async () => {
  const root = await context()
  try {
    const session = await startSession(root, 'review', 'hermes')
    const file = path.join(root, '.sessions/review', session.id, 'session.json')
    const dir = path.dirname(file)
    const outside = path.join(root, '..', `${path.basename(root)}-outside.md`)
    await mkdir(path.join(dir, 'backups'), { recursive: true })
    await writeFile(path.join(dir, 'backups/0'), 'As it was.\n')
    await mkdir(path.join(dir, 'held'), { recursive: true })
    await writeFile(path.join(dir, 'held/0'), 'From the agent.\n')

    // Written by hand: a change and a held file that climb out, and a backup that points away.
    const poisoned = JSON.parse(await readFile(file, 'utf8'))
    poisoned.changes = [
      { path: `../${path.basename(root)}-outside.md`, backup: '0', reverted: false },
      { path: 'shelf/classification.md', backup: '../session.json', reverted: false }
    ]
    poisoned.held = [{ path: `../${path.basename(root)}-outside.md`, file: '0', state: 'waiting' }]
    await writeFile(file, JSON.stringify(poisoned))

    await assert.rejects(revertChange(root, 'review', session.id, 0), /not a file of this context/)
    await assert.rejects(revertChange(root, 'review', session.id, 1), /no copy Mate kept/)
    await assert.rejects(settleHeld(root, 'review', session.id, 0, true), /not a file of this context/)
    assert.equal(existsSync(outside), false)

    // A sound change still reverts: the file is as it was, and what was there is kept beside the backup.
    const sound = JSON.parse(await readFile(file, 'utf8'))
    sound.changes = [{ path: 'shelf/classification.md', backup: '0', reverted: false }]
    sound.held = []
    await writeFile(file, JSON.stringify(sound))
    await writeFile(path.join(root, 'shelf/classification.md'), 'Changed.\n')
    const reverted = await revertChange(root, 'review', session.id, 0)
    assert.equal(reverted.changes[0].reverted, true)
    assert.equal(await readFile(path.join(root, 'shelf/classification.md'), 'utf8'), 'As it was.\n')
    assert.equal(await readFile(path.join(dir, 'backups/0.reverted'), 'utf8'), 'Changed.\n')
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
    assert.deepEqual(sshArgs('agent-host.example', 'hermes', ["it's"]).slice(-4), ['agent-host.example', '--', "'hermes'", `'it'\\''s'`])
    assert.throws(() => sshArgs('-oProxyCommand=evil', 'hermes', []), /not a host/)
    assert.equal(listAgents().filter((agent) => agent.host !== null).every((agent) => agent.kind === 'hermes'), true)
    await assert.rejects(startSession(root, 'review', 'claude', 'agent-host.example'), /another machine/)

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

    const session = await startSession(root, 'review', 'hermes', 'agent-host.example')
    const planned = await (await sendMessage(root, 'review', session.id, 'Tighten the draft.', false, () => {})).finished
    // Not approved: nothing is written. Both changes wait, and the one outside the context is refused.
    assert.equal(await draft(), 'Draft text.\n')
    assert.equal(await shelf(), 'Shelf text.\n')
    assert.deepEqual(planned.held.map((held) => held.path), ['projects/review/draft/document.md', 'shelf/classification.md'])
    assert.match(planned.messages[1].text, /^I would change two files\.\n\*\(new text for `projects\/review\/draft\/document\.md`\)\*/)
    assert.match(planned.messages.at(-1)!.text, /will not write: \.\.\/outside\.md/)

    const [first] = await asked()
    assert.deepEqual(first.args.slice(4, 6), ['agent-host.example', '--'])
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

test('a message sent while the agent works waits behind the turn, and an approval in it counts only after', { skip: process.platform === 'win32' }, async () => {
  const root = await context()
  const command = AGENTS.hermes.command
  const stub = path.join(root, '..', `${path.basename(root)}-slow.mjs`)
  const log = path.join(root, '..', `${path.basename(root)}-slow.txt`)
  try {
    // A stand-in that takes its time, and edits the draft every turn.
    await writeFile(
      stub,
      `#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs'
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ prompt: readFileSync(0, 'utf8') }) + '\\n')
await new Promise((resolve) => setTimeout(resolve, 400))
appendFileSync('draft/document.md', 'Agent line.\\n')
console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }))
console.log(JSON.stringify({ type: 'text', text: 'Done.' }))
`
    )
    await chmod(stub, 0o755)
    AGENTS.hermes.command = stub
    const draft = () => readFile(path.join(root, 'projects/review/draft/document.md'), 'utf8')

    const session = await startSession(root, 'review', 'hermes')
    const other = await startSession(root, 'sibling', 'hermes')
    const first = await sendMessage(root, 'review', session.id, 'Plan it.', false, () => {})

    // Two more while it works: an approval, and a remark. Neither stops the turn.
    const approval = await sendMessage(root, 'review', session.id, '', true, () => {})
    const remark = await sendMessage(root, 'review', session.id, 'And keep it short.', false, () => {})
    assert.equal(approval.started.planApproved, false)
    assert.deepEqual(remark.started.messages.slice(-2).map((message) => [message.text, message.waiting]), [
      ['The plan is approved. Go ahead.', true],
      ['And keep it short.', true]
    ])
    assert.equal(remark.started.running, true)
    await assert.rejects(sendMessage(root, 'sibling', other.id, 'Me too.', false, () => {}), /Another agent is working/)

    const done = await first.finished
    const asked = (await readFile(log, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
    assert.equal(asked.length, 2)
    assert.match(asked[0].prompt, /not approved yet[\s\S]*Plan it\.$/)
    assert.match(asked[1].prompt, /^\[The plan is approved\.[^\]]*\]\n\nThe plan is approved\. Go ahead\.\n\nAnd keep it short\.$/)

    // The first turn ran before the approval: its edit was put back and is held. The second one's is kept.
    assert.equal(await draft(), 'Draft text.\nAgent line.\n')
    assert.deepEqual(done.held.map((held) => held.path), ['projects/review/draft/document.md'])
    assert.deepEqual(done.changes.map((change) => change.path), ['projects/review/draft/document.md'])
    assert.equal(done.planApproved, true)
    assert.equal(done.running, false)
    assert.deepEqual(done.queue, [])
    assert.equal(done.messages.some((message) => message.waiting), false)
    assert.deepEqual(done.messages.map((message) => message.role), ['you', 'agent', 'you', 'you', 'mate', 'agent'])

    // Nothing is left taken: the other project's agent can work now, and this session reads the same from the file.
    assert.equal((await (await sendMessage(root, 'sibling', other.id, 'Now me.', false, () => {})).finished).messages[1].text, 'Done.')
    assert.deepEqual((await loadSession(root, 'review', session.id)).messages.length, 6)
  } finally {
    AGENTS.hermes.command = command
    await rm(root, { recursive: true, force: true })
    await rm(stub, { force: true })
    await rm(log, { force: true })
  }
})

test('trust is kept outside the context, by the real path of the folder, and a damaged list trusts nothing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-trust-'))
  try {
    const list = path.join(root, 'trusted.json')
    const mine = path.join(root, 'mine')
    const other = path.join(root, 'other')
    await mkdir(mine)
    await mkdir(other)
    await symlink(mine, path.join(root, 'link'))

    keepTrustIn(list)
    assert.equal(isTrusted(mine), false)
    setTrusted(mine, true)
    assert.deepEqual([isTrusted(mine), isTrusted(path.join(root, 'link')), isTrusted(other)], [true, true, false])
    // Nothing in the trusted folder says so. The list is the only place.
    assert.deepEqual(await readdir(mine), [])

    // It is still trusted when the app starts again, and not once the reader takes the trust away.
    keepTrustIn(list)
    assert.equal(isTrusted(mine), true)
    setTrusted(mine, false)
    keepTrustIn(list)
    assert.equal(isTrusted(mine), false)

    await writeFile(list, '{"not": "a list"')
    keepTrustIn(list)
    assert.equal(isTrusted(mine), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
