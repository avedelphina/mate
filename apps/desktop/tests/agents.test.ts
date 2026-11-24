import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, truncate, utimes, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { AGENTS, SSH, addable, discoverAgents, sshArgs } from '../src/main/agents.ts'
import { addComment, writeNote } from '../src/main/context.ts'
import { changesSince, fingerprints, put, takeSnapshot } from '../src/main/guard.ts'
import { compare, judge, listAllSessions, listSessions, deleteSession, loadSession, pinSession, pruneEmptySessions, revertChange, sendMessage, settleHeld, startSession } from '../src/main/sessions.ts'
import { isParallel, isTrusted, keepTrustIn, setParallel, setTrusted } from '../src/main/trust.ts'
import { copyOf, keepCopiesIn } from '../src/main/copies.ts'

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
  // On a copy, Claude may read the context and may not edit it: the real path is named in a rule that refuses editing.
  assert.ok(!AGENTS.claude.args(turn).includes('--disallowedTools'))
  const onCopy = AGENTS.claude.args({ ...turn, contextDir: tmpdir(), copy: true })
  assert.equal(onCopy[onCopy.indexOf('--disallowedTools') + 1], `Edit(/${realpathSync(tmpdir())}/**)`)
  assert.ok(AGENTS.claude.args({ ...turn, mayWrite: true, resume: 'abc' }).join(' ').includes('acceptEdits'))
  assert.deepEqual(AGENTS.claude.args({ ...turn, resume: 'abc' }).slice(-2), ['--resume', 'abc'])
  assert.ok(AGENTS.codex.args(turn).includes('read-only'))
  assert.deepEqual(AGENTS.codex.args({ ...turn, mayWrite: true, resume: 'abc' }).slice(-3), ['resume', 'abc', '-'])
  assert.deepEqual(AGENTS.hermes.args(turn).slice(-2), ['-t', 'file'])
  // A model and an effort the reader chose go on the command line. Nothing that reads as an option does.
  assert.deepEqual(AGENTS.hermes.args({ ...turn, model: 'shop:big/model-1', effort: 'low' }).slice(-4), ['-m', 'shop:big/model-1', '--reasoning', 'low'])
  assert.deepEqual(AGENTS.hermes.args({ ...turn, model: '--yolo', effort: '--yolo' }).slice(-2), ['-t', 'file'])
  // Only Hermes has a way to stay between turns with all its tools. It is used in a trusted context only.
  assert.deepEqual([AGENTS.hermes.acp, AGENTS.claude.acp, AGENTS.codex.acp], [['acp'], undefined, undefined])
  // Kimi cannot be held to files, so it has only that way, and no command line of its own.
  assert.deepEqual([AGENTS.kimi.acp, AGENTS.kimi.trustedOnly], [['acp'], true])
  assert.throws(() => AGENTS.kimi.args(turn), /only in a context you trust/)

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
    // Obsidian's settings, opened in the same folder, are not the agent's work.
    await mkdir(path.join(root, '.obsidian'), { recursive: true })
    await writeFile(path.join(root, '.obsidian/workspace.json'), '{}')

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

test('the sessions of every project are listed together, and one that is only in the cloud is not fetched', async () => {
  const root = await context()
  try {
    assert.deepEqual(await listAllSessions(root), [])
    await mkdir(path.join(root, 'projects/other'), { recursive: true })
    const first = await startSession(root, 'review', 'hermes')
    const second = await startSession(root, 'other', 'hermes')
    // A file that Synology has not downloaded has a size and no blocks. Reading it would wait for the download.
    const placeholder = path.join(root, '.sessions/other/cloud-only')
    await mkdir(placeholder, { recursive: true })
    await writeFile(path.join(placeholder, 'session.json'), '')
    await truncate(path.join(placeholder, 'session.json'), 4096)
    const rows = await listAllSessions(root)
    assert.deepEqual(
      rows.map((row) => [row.project, row.cloud, row.agent]).sort(),
      [['other', false, 'hermes'], ['other', true, null], ['review', false, 'hermes']]
    )
    assert.deepEqual(rows.find((row) => row.id === first.id)?.title, null)
    // The reader's first words are the title.
    const said = { ...first, messages: [{ role: 'you' as const, text: 'Review the contract', tools: [] }] }
    await writeFile(path.join(root, '.sessions/review', first.id, 'session.json'), JSON.stringify(said))
    const row = (await listAllSessions(root)).find((each) => each.id === first.id)
    assert.equal(row?.title, 'Review the contract')
    // What was said travels with the row, so the list can be searched.
    assert.match(row?.said ?? '', /contract/)
    assert.ok(rows.some((row) => row.id === second.id))
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
    assert.equal(discoverAgents('ssh').every((agent) => agent.kind === 'hermes'), true)
    assert.equal(addable('hermes', 'agent-host.example'), true)
    assert.equal(addable('hermes', null), true)
    assert.equal(addable('claude', 'agent-host.example'), false)
    assert.equal(addable('hermes', '-oProxyCommand=evil'), false)
    assert.equal(addable('nobody', null), false)
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

    // A comment the reader keeps private is in the context, not in the draft. The agent on the other machine is sent it too.
    await addComment(root, 'review', 'document.md', 'Draft text.', 'Why this?', 'you')
    // A pane and a note are in the context too. The agent is sent them as files of the project.
    await mkdir(path.join(root, '.mate/projects/review/panes'), { recursive: true })
    await writeFile(path.join(root, '.mate/projects/review/panes/tasks.md'), '- [ ] Label it\n')
    await writeNote(root, 'review', 'draft/document.md', '', 'Written for the lab.\n')

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

    assert.match(first.prompt, /<file path="\.mate\/projects\/review\/draft\/document\.md\.comments\.md" kind="private comments of the reviewer on projects\/review\/draft\/document\.md">\n[\s\S]*Why this\?/)

    assert.match(first.prompt, /<file path="projects\/review\/panes\/tasks\.md" kind="pane of project review">\n- \[ \] Label it/)
    assert.match(first.prompt, /<file path="projects\/review\/draft\/document\.md\.notes\.md" kind="material of project review">\nWritten for the lab\./)

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
    // The turn is written down while it runs, with the reader's message, in case the app does not live to end it.
    const note = path.join(root, '.sessions/review', session.id, 'turn.json')
    assert.equal(JSON.parse(await readFile(note, 'utf8')).pid, process.pid)
    assert.equal(JSON.parse(await readFile(path.join(path.dirname(note), 'session.json'), 'utf8')).messages[0].text, 'Plan it.')

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
    assert.equal(existsSync(note), false)
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

test('a change can be looked at as lines, while it is held and after it is kept', async () => {
  const root = await context()
  const command = AGENTS.hermes.command
  const stub = path.join(root, '..', `${path.basename(root)}-differ.mjs`)
  try {
    // A stand-in that adds a line to the draft and makes a file that is not text.
    await writeFile(
      stub,
      `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from 'node:fs'
appendFileSync('draft/document.md', 'Agent line.\\n')
writeFileSync('draft/sheet.bin', Buffer.from([80, 75, 0, 1, 2]))
console.log(JSON.stringify({ type: 'text', text: 'Done.' }))
`
    )
    await chmod(stub, 0o755)
    AGENTS.hermes.command = stub
    const added = { lines: [{ kind: ' ', text: 'Draft text.' }, { kind: '+', text: 'Agent line.' }] }
    const session = await startSession(root, 'review', 'hermes')

    // Held: the file is as it was, and the reader sees what the agent wants to make of it.
    const planned = await (await sendMessage(root, 'review', session.id, 'Go.', false, () => {})).finished
    const held = planned.held.findIndex((each) => each.path.endsWith('document.md'))
    assert.deepEqual(await compare(root, 'review', session.id, 'held', held), added)

    // Kept: what the file holds now, against the copy from before the change.
    const kept = await (await sendMessage(root, 'review', session.id, '', true, () => {})).finished
    const index = (name: string) => kept.changes.findIndex((each) => each.path.endsWith(name))
    assert.deepEqual(await compare(root, 'review', session.id, 'kept', index('document.md')), added)
    assert.match(((await compare(root, 'review', session.id, 'kept', index('sheet.bin'))) as { note: string }).note, /Not a text file/)
    await assert.rejects(compare(root, 'review', session.id, 'kept', 99), /not there/)
  } finally {
    AGENTS.hermes.command = command
    await rm(root, { recursive: true, force: true })
    await rm(stub, { force: true })
  }
})

test('a turn the app did not live to end is said to be cut off, with the files that are not as they were', async () => {
  const root = await context()
  try {
    const session = await startSession(root, 'review', 'hermes')
    const dir = path.join(root, '.sessions/review', session.id)
    // As the app leaves it when it is closed in the middle of a turn: the reader's message, an answer not begun,
    // and the note of the turn, written by a process that is gone.
    const saved = JSON.parse(await readFile(path.join(dir, 'session.json'), 'utf8'))
    saved.messages.push({ role: 'you', text: 'Tidy it.', tools: [] }, { role: 'agent', text: '', tools: [] })
    saved.running = true
    await writeFile(path.join(dir, 'session.json'), JSON.stringify(saved))
    const gone = spawnSync(process.execPath, ['-e', '']).pid
    await writeFile(path.join(dir, 'turn.json'), JSON.stringify({ pid: gone, files: fingerprints(await takeSnapshot(root)) }))
    // What the agent did before the app closed. Nobody looked at it.
    await writeFile(path.join(root, 'shelf/classification.md'), 'Changed by the agent.\n')
    await writeFile(path.join(root, 'projects/review/draft/new.md'), 'New.\n')

    const back = await loadSession(root, 'review', session.id)
    assert.equal(back.running, false)
    assert.deepEqual(back.messages.map((each) => each.role), ['you', 'mate'])
    assert.equal(back.messages[1].cut, true)
    assert.match(back.messages[1].text, /cut off[\s\S]*: projects\/review\/draft\/new\.md, shelf\/classification\.md\. Nothing was put back\./)
    assert.equal(existsSync(path.join(dir, 'turn.json')), false)
    // It is said once.
    assert.equal((await loadSession(root, 'review', session.id)).messages.length, 2)

    // A note written by a process that is alive is another Mate in the middle of that turn. It is left alone.
    await writeFile(path.join(dir, 'turn.json'), JSON.stringify({ pid: process.ppid, files: {} }))
    assert.equal((await loadSession(root, 'review', session.id)).messages.length, 2)
    assert.equal(existsSync(path.join(dir, 'turn.json')), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('what git runs in a project that is a repository of its own is never kept for an agent, plan or no plan', async () => {
  const root = await context()
  try {
    await mkdir(path.join(root, 'projects/review/.git/hooks'), { recursive: true })
    await writeFile(path.join(root, 'projects/review/.git/config'), '[core]\n')
    const session = { ...(await startSession(root, 'review', 'hermes')), planApproved: true }
    // The guard watches the hooks and the config of the project's repository, as it does the context's.
    assert.ok((await takeSnapshot(root)).has('projects/review/.git/config'))
    const hook = { path: 'projects/review/.git/hooks/pre-commit', before: null, after: Buffer.from('#!/bin/sh\ncurl example.org\n') }
    assert.equal(await judge(root, session, hook, false), 'held')
    assert.equal(existsSync(path.join(root, 'projects/review/.git/hooks/pre-commit')), false)
    // The same agent's change to a draft of the project is kept, since its plan is approved.
    const draft = { path: 'projects/review/draft/document.md', before: Buffer.from('Draft text.\n'), after: Buffer.from('New.\n') }
    assert.equal(await judge(root, session, draft, false), 'kept')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an agent is told what steers its project: its own files, else the context\'s, else that nothing does', { skip: process.platform === 'win32' }, async () => {
  const root = await context()
  const command = AGENTS.hermes.command
  const stub = path.join(root, '..', `${path.basename(root)}-steer.mjs`)
  const log = path.join(root, '..', `${path.basename(root)}-steer.txt`)
  try {
    await writeFile(
      stub,
      `#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs'
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ prompt: readFileSync(0, 'utf8') }) + '\\n')
console.log(JSON.stringify({ type: 'text', text: 'Read.' }))
`
    )
    await chmod(stub, 0o755)
    AGENTS.hermes.command = stub
    const told = async (project: string) => {
      const session = await startSession(root, project, 'hermes')
      await (await sendMessage(root, project, session.id, 'Look.', false, () => {})).finished
      const lines = (await readFile(log, 'utf8')).trim().split('\n')
      return JSON.parse(lines[lines.length - 1]).prompt as string
    }

    // Its own: `review` has an intents.md and no principles.md.
    let prompt = await told('review')
    assert.match(prompt, /Its intents\.md:\n\nStay honest\./)
    assert.doesNotMatch(prompt, /Nothing steers this project/)
    assert.doesNotMatch(prompt, /The context's principles\.md/)

    // None of its own, none of the context's: the agent is told so, and not to look.
    prompt = await told('sibling')
    assert.match(prompt, /Nothing steers this project: it has no intents\.md or principles\.md, and neither has the context\./)

    // The context's steer a project that has none.
    await writeFile(path.join(root, 'principles.md'), 'Never send a document outside.\n')
    prompt = await told('sibling')
    assert.match(prompt, /The context's principles\.md, which steers this project because it has none of its own:\n\nNever send a document outside\./)
    assert.doesNotMatch(prompt, /Nothing steers this project/)
    // The rules say where to look, so an agent is not sent after a file that is not there.
    assert.match(prompt, /do not look for them/)
  } finally {
    AGENTS.hermes.command = command
    await rm(root, { recursive: true, force: true })
    await rm(stub, { force: true })
    await rm(log, { force: true })
  }
})

test('inviting an agent twice leaves one empty conversation, and the empty ones can be deleted', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-empty-'))
  try {
    const first = await startSession(root, 'review', 'hermes')
    // Nothing was said: the same conversation is given again, and a different agent gets its own.
    assert.equal((await startSession(root, 'review', 'hermes')).id, first.id)
    const other = await startSession(root, 'review', 'kimi')
    assert.notEqual(other.id, first.id)
    // Once something is said, it is no longer empty, and the next invitation starts a new one.
    const spoken = { ...first, messages: [{ role: 'you' as const, text: 'Hello', tools: [] }] }
    await writeFile(path.join(root, '.sessions/review', first.id, 'session.json'), JSON.stringify(spoken))
    assert.notEqual((await startSession(root, 'review', 'hermes')).id, first.id)
    assert.deepEqual((await listAllSessions(root)).filter((row) => row.empty).length, 2)
    // Only the empty ones go.
    assert.equal(await pruneEmptySessions(root), 2)
    assert.deepEqual((await listAllSessions(root)).map((row) => row.id), [first.id])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a conversation is pinned, kept when empty ones go, and deleted on its own', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-pin-'))
  try {
    const keep = await startSession(root, 'review', 'hermes')
    const drop = await startSession(root, 'review', 'kimi')
    // A pinned conversation is wanted, even with nothing said in it, so it is not one of the empty.
    await pinSession(root, 'review', keep.id, true)
    const rows = await listAllSessions(root)
    assert.equal(rows.find((row) => row.id === keep.id)?.pinned, true)
    assert.equal(rows.find((row) => row.id === keep.id)?.empty, false)
    assert.equal(await pruneEmptySessions(root), 1)
    assert.deepEqual((await listAllSessions(root)).map((row) => row.id), [keep.id])
    // One conversation goes by itself, and a name that climbs out is refused.
    await deleteSession(root, 'review', keep.id)
    assert.deepEqual(await listAllSessions(root), [])
    await assert.rejects(deleteSession(root, 'review', keep.id), /not there/)
    await assert.rejects(deleteSession(root, '..', drop.id))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('agents work on different projects at once, each judged for its own project, when the reader allowed it', { skip: process.platform === 'win32' }, async () => {
  const root = await context()
  const command = AGENTS.hermes.command
  try {
    // An agent that works for the time the message says, writes in its own project, and the one called review also writes the shelf.
    const stub = path.join(root, '..', `${path.basename(root)}-slow.mjs`)
    await writeFile(
      stub,
      `#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
const prompt = readFileSync(0, 'utf8')
const delay = Number(/delay (\\d+)/.exec(prompt)?.[1] ?? 0)
const project = process.cwd().split('/').pop()
await new Promise((resolve) => setTimeout(resolve, delay))
appendFileSync('draft/out.md', project + ' line.\\n')
if (project === 'review') writeFileSync('../../shelf/classification.md', 'Agent shelf.\\n')
console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's-' + project }))
console.log(JSON.stringify({ type: 'text', text: 'Done in ' + project }))
`
    )
    await chmod(stub, 0o755)
    AGENTS.hermes.command = stub
    const read = (relative: string) => readFile(path.join(root, relative), 'utf8')
    const work = async (project: string, delay: number) => {
      const session = await startSession(root, project, 'hermes')
      const { finished } = await sendMessage(root, project, session.id, `Go. delay ${delay}`, true, () => {})
      return { session, finished }
    }

    // Not allowed: the second waits, as before.
    const alone = await work('review', 300)
    await assert.rejects(work('sibling', 0), /Another agent is working in this context/)
    await alone.finished
    assert.equal(isParallel(root), false)

    setParallel(root, true)
    // The first is slow and the second quick: the second has finished, and kept its change, when the first ends.
    const slow = await work('review', 600)
    const quick = await work('sibling', 50)
    // Two in one project never run together.
    await assert.rejects(sendMessage(root, 'review', (await startSession(root, 'review', 'hermes')).id, 'Again. delay 0', true, () => {}), /Another agent is working in this project/)
    const [reviewed, sibling] = await Promise.all([slow.finished, quick.finished])
    assert.deepEqual(sibling.changes.map((change) => change.path), ['projects/sibling/draft/out.md'])
    assert.deepEqual(sibling.held, [])
    assert.deepEqual(reviewed.changes.map((change) => change.path), ['projects/review/draft/out.md'])
    // What review wrote outside its project is held and put back, and nothing of sibling's is taken for its.
    assert.deepEqual(reviewed.held.map((held) => held.path), ['shelf/classification.md'])
    assert.equal(await read('projects/sibling/draft/out.md'), 'sibling line.\n')
    assert.equal(await read('projects/review/draft/out.md'), 'review line.\nreview line.\n')
    assert.equal(await read('shelf/classification.md'), 'Shelf text.\n')

    // The other way round: the second is the slow one, and the first ends while it is still working.
    const quickReview = await work('review', 50)
    const slowSibling = await work('sibling', 600)
    const [again, last] = await Promise.all([quickReview.finished, slowSibling.finished])
    assert.deepEqual(again.changes.map((change) => change.path), ['projects/review/draft/out.md'])
    assert.deepEqual(last.changes.map((change) => change.path), ['projects/sibling/draft/out.md'])
    assert.deepEqual(last.held, [])
    assert.equal(await read('projects/sibling/draft/out.md'), 'sibling line.\nsibling line.\n')
  } finally {
    AGENTS.hermes.command = command
    setParallel(root, false)
    await rm(root, { recursive: true, force: true })
    await rm(path.join(root, '..', `${path.basename(root)}-slow.mjs`), { force: true })
  }
})

test('an agent given a folder of the project changes only there, and another works in another folder at once', { skip: process.platform === 'win32' }, async () => {
  const root = await context()
  const command = AGENTS.hermes.command
  try {
    await mkdir(path.join(root, 'projects/review/a'), { recursive: true })
    await mkdir(path.join(root, 'projects/review/b'), { recursive: true })
    await mkdir(path.join(root, 'projects/review/panes'), { recursive: true })
    // The agent writes in the folder the message names, and also a file in the project's own folder.
    const stub = path.join(root, '..', `${path.basename(root)}-folder.mjs`)
    await writeFile(
      stub,
      `#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
const prompt = readFileSync(0, 'utf8')
const delay = Number(/delay (\\d+)/.exec(prompt)?.[1] ?? 0)
const dir = /dir (\\w+)/.exec(prompt)?.[1]
await new Promise((resolve) => setTimeout(resolve, delay))
appendFileSync(dir + '/out.md', dir + ' line.\\n')
writeFileSync('stray-' + dir + '.md', 'Not in the folder.\\n')
console.log(JSON.stringify({ type: 'text', text: 'Done in ' + dir }))
`
    )
    await chmod(stub, 0o755)
    AGENTS.hermes.command = stub
    const read = (relative: string) => readFile(path.join(root, relative), 'utf8')

    // A folder is one of the project, with nothing hidden, and not the panes. An agent the reader runs, or on another machine, has none.
    for (const bad of ['../x', 'a/../b', '.git', 'a/.hidden', 'panes', 'nothing']) await assert.rejects(startSession(root, 'review', 'hermes', null, bad), /folder/i)
    // The message is the same wherever the folder is missing from, and not a system's own: it is what the reader is told.
    await assert.rejects(startSession(root, 'review', 'hermes', null, 'nothing'), /That folder is not in the project\./)
    await assert.rejects(startSession(root, 'review', 'mcp', null, 'a'), /Only an agent started here/)
    await assert.rejects(startSession(root, 'review', 'hermes', 'some-host', 'a'), /Only an agent started here/)

    const inA = await startSession(root, 'review', 'hermes', null, 'a/')
    assert.equal(inA.folder, 'a')
    // An empty conversation with the same agent is given back only for the same folder.
    assert.equal((await startSession(root, 'review', 'hermes', null, 'a')).id, inA.id)
    assert.notEqual((await startSession(root, 'review', 'hermes', null, 'b')).id, inA.id)
    assert.notEqual((await startSession(root, 'review', 'hermes')).id, inA.id)

    const go = async (session: { id: string }, text: string) => (await sendMessage(root, 'review', session.id, text, true, () => {})).finished
    setParallel(root, true)
    const first = await sendMessage(root, 'review', inA.id, 'Go. dir a delay 500', true, () => {})
    const inB = await startSession(root, 'review', 'hermes', null, 'b')
    const second = await sendMessage(root, 'review', inB.id, 'Go. dir b delay 50', true, () => {})
    // The same folder, or the whole project around it, is taken.
    await assert.rejects(go(await startSession(root, 'review', 'kimi', null, 'a'), 'dir a delay 0'), /this folder, or the project around it/)
    await assert.rejects(go(await startSession(root, 'review', 'hermes'), 'dir a delay 0'), /this project/)
    const [done, other] = await Promise.all([first.finished, second.finished])

    // Each kept its folder. The file in the project's own folder is neither's to change: it is held and put back.
    assert.deepEqual(done.changes.map((change) => change.path), ['projects/review/a/out.md'])
    assert.deepEqual(other.changes.map((change) => change.path), ['projects/review/b/out.md'])
    assert.deepEqual(done.held.map((held) => held.path), ['projects/review/stray-a.md'])
    assert.deepEqual(other.held.map((held) => held.path), ['projects/review/stray-b.md'])
    assert.equal(existsSync(path.join(root, 'projects/review/stray-a.md')), false)
    assert.equal(existsSync(path.join(root, 'projects/review/stray-b.md')), false)
    assert.equal(await read('projects/review/a/out.md'), 'a line.\n')
    assert.equal(await read('projects/review/b/out.md'), 'b line.\n')
    assert.match(done.messages.find((message) => message.role === 'mate')?.text ?? '', /outside the folder a\//)
    // A conversation in a folder says so in the list.
    assert.equal((await listAllSessions(root)).find((row) => row.id === inA.id)?.folder, 'a')
  } finally {
    AGENTS.hermes.command = command
    setParallel(root, false)
    await rm(root, { recursive: true, force: true })
    await rm(path.join(root, '..', `${path.basename(root)}-folder.mjs`), { force: true })
  }
})

test('a snapshot reads again only the files the folder says have changed', async () => {
  const root = await context()
  try {
    const hourAgo = new Date(Date.now() - 3600_000)
    await writeFile(path.join(root, 'shelf/old.md'), 'Old text.\n')
    await utimes(path.join(root, 'shelf/old.md'), hourAgo, hourAgo)
    const first = await takeSnapshot(root)
    // Nothing changed: the second snapshot holds the very bytes of the first, for a file that has not been touched for a long time.
    const second = await takeSnapshot(root, first)
    assert.equal(second.get('shelf/old.md'), first.get('shelf/old.md'))
    // A file written a moment ago is read again every time: it may be written once more to the same stamp.
    assert.notEqual(second.get('shelf/classification.md'), first.get('shelf/classification.md'))
    assert.deepEqual(await changesSince(root, first), [])

    // The same size, and the old time stamp put back: the change time still says it was written.
    await writeFile(path.join(root, 'shelf/old.md'), 'New text.\n')
    await utimes(path.join(root, 'shelf/old.md'), hourAgo, hourAgo)
    const changes = await changesSince(root, first)
    assert.deepEqual(changes.map((change) => [change.path, change.before?.toString(), change.after?.toString()]), [['shelf/old.md', 'Old text.\n', 'New text.\n']])
    // A file that is gone, or new, is found too.
    await rm(path.join(root, 'shelf/old.md'))
    await writeFile(path.join(root, 'shelf/made.md'), 'Made.\n')
    assert.deepEqual((await changesSince(root, first)).map((change) => [change.path, change.before === null, change.after === null]), [
      ['shelf/made.md', true, false],
      ['shelf/old.md', false, true]
    ])
    // Hashes of what did not change come from the same bytes.
    assert.deepEqual(fingerprints(first)['shelf/classification.md'], fingerprints(await takeSnapshot(root, first))['shelf/classification.md'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a session on a copy never writes the project while it works, and what it changed is put back at the end of the turn', { skip: process.platform === 'win32' }, async () => {
  const root = await context()
  const command = AGENTS.claude.command
  const copies = await mkdtemp(path.join(tmpdir(), 'mate-copies-'))
  try {
    keepCopiesIn(copies)
    keepTrustIn(path.join(copies, 'trusted.json'))
    // The project is a repository, with a file git ignores and one the agent is not told of.
    const project = path.join(root, 'projects/review')
    spawnSync('git', ['init', '-q'], { cwd: project })
    await writeFile(path.join(project, '.gitignore'), 'ignored.txt\n')
    await writeFile(path.join(project, 'ignored.txt'), 'Never copied.\n')
    await writeFile(path.join(project, 'other.md'), 'Other.\n')
    // The agent says where it is, edits its draft and a new file, and writes the shelf through the link it was given.
    const stub = path.join(root, '..', `${path.basename(root)}-copy.mjs`)
    const where = path.join(root, '..', `${path.basename(root)}-where.txt`)
    await writeFile(
      stub,
      `#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
const prompt = readFileSync(0, 'utf8')
const delay = Number(/delay (\\d+)/.exec(prompt)?.[1] ?? 0)
appendFileSync(${JSON.stringify(where)}, process.cwd() + ' ' + existsSync('.git') + ' ' + existsSync('ignored.txt') + ' ' + existsSync('../../shelf/classification.md') + '\\n')
await new Promise((resolve) => setTimeout(resolve, delay))
appendFileSync('draft/document.md', 'Agent line.\\n')
writeFileSync('new.md', 'New.\\n')
if (/WRITE_SHELF/.test(prompt)) writeFileSync('../../shelf/classification.md', 'Agent shelf.\\n')
if (/WRITE_OTHER/.test(prompt)) appendFileSync('other.md', 'Agent other.\\n')
`
    )
    await chmod(stub, 0o755)
    AGENTS.claude.command = stub
    const read = (relative: string) => readFile(path.join(root, relative), 'utf8')

    // Only a repository in a context the reader trusts, and not an agent that is not started here.
    await assert.rejects(startSession(root, 'review', 'claude', null, '', true), /context you trust/)
    setTrusted(root, true)
    await assert.rejects(startSession(root, 'sibling', 'claude', null, '', true), /repository/)
    await assert.rejects(startSession(root, 'review', 'mcp', null, '', true), /started here/)

    const session = await startSession(root, 'review', 'claude', null, '', true)
    assert.equal(session.copy, true)
    // Before the plan is approved, the agent's changes wait. The project is as it was.
    const planned = await (await sendMessage(root, 'review', session.id, 'Go.', false, () => {})).finished
    assert.equal(await read('projects/review/draft/document.md'), 'Draft text.\n')
    assert.equal(existsSync(path.join(project, 'new.md')), false)
    assert.deepEqual(planned.held.map((held) => held.path).sort(), ['projects/review/draft/document.md', 'projects/review/new.md'])
    assert.match(planned.messages.find((message) => message.role === 'mate')?.text ?? '', /before the plan was approved. It was on a copy/)
    // The agent worked in the copy, which has no .git and no ignored file, and reads the context through links.
    const [where1] = (await readFile(where, 'utf8')).trim().split('\n')
    assert.equal(where1, `${path.join(await realpath(copyOf(root, session.id)), 'projects/review')} false false true`)

    // Approved. What the agent changed goes into the project, and can be reverted. What it wrote through the link is held and put back.
    const done = await (await sendMessage(root, 'review', session.id, 'Go on. WRITE_SHELF', true, () => {})).finished
    assert.equal(await read('projects/review/draft/document.md'), 'Draft text.\nAgent line.\n')
    assert.equal(await read('projects/review/new.md'), 'New.\n')
    assert.equal(await read('shelf/classification.md'), 'Shelf text.\n')
    assert.deepEqual(done.changes.map((change) => change.path).sort(), ['projects/review/draft/document.md', 'projects/review/new.md'])
    assert.ok(done.held.some((held) => held.path === 'shelf/classification.md'))
    await revertChange(root, 'review', session.id, done.changes.findIndex((change) => change.path === 'projects/review/new.md'))
    assert.equal(existsSync(path.join(project, 'new.md')), false)

    // The reader changes a file while the agent works on it: the agent's version is held, and the reader's stays.
    const racing = await sendMessage(root, 'review', session.id, 'Again. WRITE_OTHER delay 400', false, () => {})
    await new Promise((resolve) => setTimeout(resolve, 150))
    await writeFile(path.join(project, 'other.md'), 'Reader edit.\n')
    const raced = await racing.finished
    assert.equal(await read('projects/review/other.md'), 'Reader edit.\n')
    assert.ok(raced.held.some((held) => held.path === 'projects/review/other.md'))

    // Two sessions on copies work in one project at once, without the setting that in-place sessions need.
    const second = await startSession(root, 'review', 'claude', null, '', true)
    assert.notEqual(second.id, session.id)
    const first = await sendMessage(root, 'review', session.id, 'Both. delay 300', true, () => {})
    const other = await sendMessage(root, 'review', second.id, 'Both. delay 50', true, () => {})
    await Promise.all([first.finished, other.finished])
    assert.equal(isParallel(root), false)

    // Deleting the conversation takes the copy with it. Nothing of the context goes.
    await deleteSession(root, 'review', session.id)
    assert.equal(existsSync(copyOf(root, session.id)), false)
    assert.equal(await read('shelf/classification.md'), 'Shelf text.\n')
  } finally {
    AGENTS.claude.command = command
    setTrusted(root, false)
    await rm(root, { recursive: true, force: true })
    await rm(copies, { recursive: true, force: true })
    await rm(path.join(root, '..', `${path.basename(root)}-copy.mjs`), { force: true })
    await rm(path.join(root, '..', `${path.basename(root)}-where.txt`), { force: true })
  }
})
