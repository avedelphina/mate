import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { outcome } from '../src/main/acp.ts'
import { AGENTS } from '../src/main/agents.ts'
import { answerAsk, listModels, sendMessage, startSession, tuneSession, type Session } from '../src/main/sessions.ts'
import { keepTrustIn, setTrusted } from '../src/main/trust.ts'

test('a yes to an agent is for this once, and a yes it cannot take that way is a no', () => {
  const offered = [
    { kind: 'allow_always', optionId: 'always' },
    { kind: 'allow_once', optionId: 'once' },
    { kind: 'reject_once', optionId: 'no' }
  ]
  assert.deepEqual(outcome(offered, true), { outcome: { outcome: 'selected', optionId: 'once' } })
  assert.deepEqual(outcome(offered, false), { outcome: { outcome: 'selected', optionId: 'no' } })
  // Only "always" is offered: Mate does not allow for good on the reader's behalf.
  assert.deepEqual(outcome([offered[0], offered[2]], true), { outcome: { outcome: 'selected', optionId: 'no' } })
  assert.deepEqual(outcome([offered[0]], true), { outcome: { outcome: 'cancelled' } })
})

/**
 * A stand-in for an agent that speaks the Agent Client Protocol. Every turn it edits the draft
 * and asks before a command, unless the message says "quick". A turn whose message says "wait"
 * goes on until it is steered.
 */
const AGENT = (log: string) => `#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
import readline from 'node:readline'
const note = (what) => appendFileSync(${JSON.stringify(log)}, JSON.stringify(what) + '\\n')
const send = (message) => console.log(JSON.stringify({ jsonrpc: '2.0', ...message }))
const say = (sessionId, update) => send({ method: 'session/update', params: { sessionId, update } })
const text = (words) => say('s1', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: words } })
note({ started: process.argv.slice(2) })
const answers = new Map()
let steered = () => {}
readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  const message = JSON.parse(line)
  if (message.method === undefined) return answers.get(message.id)?.(message.result)
  const reply = (result) => send({ id: message.id, result })
  if (message.method === 'initialize') return reply({ protocolVersion: 1 })
  if (message.method === 'session/new') return reply({ sessionId: 's1', models: { currentModelId: 'custom:own', availableModels: [
    { modelId: 'custom:own', name: 'custom · own', description: 'Provider: custom • current' },
    { modelId: 'shop:big/model-1', name: 'big/model-1', description: 'Provider: Shop' }] } })
  if (message.method === 'session/set_model') return note({ model: message.params.modelId }), reply({})
  if (message.method === 'session/set_mode') return note({ mode: message.params.modeId }), reply({})
  if (message.method !== 'session/prompt') return send({ id: message.id, error: { code: -32601, message: 'no' } })
  const said = message.params.prompt[0].text
  note({ prompt: said })
  if (said.startsWith('/steer ')) {
    text('⏩ Steer queued for the active turn: ' + said.slice(7))
    steered(said.slice(7))
    return reply({ stopReason: 'end_turn' })
  }
  // Another conversation of the same agent. It is not Mate's, and must not reach the reader.
  say('other', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'NOT YOURS' } })
  text('Working. ')
  say('s1', { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'a thought' } })
  say('s1', { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'write_file: draft/document.md', kind: 'edit' })
  appendFileSync('draft/document.md', 'Agent line.\\n')
  const answer = said.includes('quick') ? { outcome: { optionId: 'not asked' } } : await new Promise((resolve) => {
    answers.set(99, resolve)
    send({ id: 99, method: 'session/request_permission', params: { sessionId: 's1',
      toolCall: { toolCallId: 't2', title: 'terminal: rm old.txt', rawInput: { tool: 'terminal', arguments: { command: 'rm old.txt' } } },
      options: [{ kind: 'allow_once', optionId: 'yes' }, { kind: 'reject_once', optionId: 'no' }] } })
  })
  text('The answer was ' + answer.outcome.optionId + '.')
  if (said.includes('wait')) text(' Then: ' + (await new Promise((resolve) => (steered = resolve))) + '.')
  reply({ stopReason: 'end_turn' })
})
`

test('in a trusted context the agent stays, asks before it acts, and can be told something while it works', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-acp-'))
  const out = `${root}-out`
  const command = AGENTS.hermes.command
  const until = async (found: () => boolean) => {
    for (let waited = 0; !found(); waited += 20) {
      if (waited > 5000) throw new Error('It did not happen.')
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  try {
    await mkdir(path.join(root, 'projects/review/draft'), { recursive: true })
    await mkdir(out)
    await writeFile(path.join(root, 'projects/review/draft/document.md'), 'Draft text.\n')
    await writeFile(path.join(out, 'agent.mjs'), AGENT(path.join(out, 'log')))
    await chmod(path.join(out, 'agent.mjs'), 0o755)
    AGENTS.hermes.command = path.join(out, 'agent.mjs')
    keepTrustIn(path.join(out, 'trusted.json'))
    setTrusted(root, true)
    const logged = async () => (await readFile(path.join(out, 'log'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
    const draft = () => readFile(path.join(root, 'projects/review/draft/document.md'), 'utf8')

    const session = await startSession(root, 'review', 'hermes')
    let now: Session = session
    const first = await sendMessage(root, 'review', session.id, 'Tidy the draft.', false, (next) => (now = next))

    // The agent waits for the reader. The command it asks about is shown, and nothing else is.
    await until(() => (now.asks ?? []).length === 1)
    assert.deepEqual(now.asks, [{ id: 't2', title: 'terminal: rm old.txt', detail: 'rm old.txt' }])
    answerAsk(session.id, 't2', false)
    const planned = await first.finished
    assert.deepEqual(planned.asks, [])
    const said = planned.messages.at(-2)!
    assert.deepEqual([said.text, said.tools], ['Working. The answer was no.', ['write_file: draft/document.md']])
    // The plan is not approved, so the edit was put back and waits, whatever the agent was allowed.
    assert.equal(await draft(), 'Draft text.\n')
    assert.deepEqual(planned.held.map((held) => held.path), ['projects/review/draft/document.md'])

    // The approval goes to the same agent, still there. It is told only what is new, and it may edit now.
    const second = await sendMessage(root, 'review', session.id, 'And wait for me.', true, (next) => (now = next))
    await until(() => (now.asks ?? []).length === 1)
    answerAsk(session.id, 't2', true)
    await until(() => now.messages.at(-1)!.text.includes('The answer was yes.'))
    // Said mid-turn, it is taken into the turn. What the agent says after it is its answer to it.
    await sendMessage(root, 'review', session.id, 'Shorter.', false, (next) => (now = next))
    const done = await second.finished
    assert.deepEqual(
      done.messages.slice(-3).map((each) => [each.role, each.text]),
      [['agent', 'Working. The answer was yes.'], ['you', 'Shorter.'], ['agent', 'Then: Shorter..']]
    )
    assert.equal(done.messages.some((each) => each.waiting), false)
    assert.equal(await draft(), 'Draft text.\nAgent line.\n')
    assert.deepEqual(done.changes.map((change) => change.path), ['projects/review/draft/document.md'])

    const log = await logged()
    assert.deepEqual(log.filter((each) => each.started), [{ started: ['acp'] }])
    assert.deepEqual(log.filter((each) => each.mode).map((each) => each.mode), ['default', 'accept_edits'])
    const prompts = log.filter((each) => each.prompt).map((each) => each.prompt as string)
    assert.match(prompts[0], /You have been invited[\s\S]*Tidy the draft\.$/)
    assert.doesNotMatch(prompts[1], /You have been invited/)
    assert.equal(prompts[2], '/steer Shorter.')

    // Trust taken away: the agent that stayed is sent away, and the next one gets file tools only.
    setTrusted(root, false)
    await (await sendMessage(root, 'review', session.id, 'Once more.', false, (next) => (now = next))).finished
    assert.deepEqual((await logged()).filter((each) => each.started).at(-1)!.started.slice(-2), ['-t', 'file'])
  } finally {
    AGENTS.hermes.command = command
    await rm(root, { recursive: true, force: true })
    await rm(out, { recursive: true, force: true })
  }
})

test('the reader chooses the model and the effort of a conversation with Hermes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-tune-'))
  const out = `${root}-out`
  const command = AGENTS.hermes.command
  try {
    await mkdir(path.join(root, 'projects/review/draft'), { recursive: true })
    await mkdir(out)
    await writeFile(path.join(root, 'projects/review/draft/document.md'), 'Draft text.\n')
    await writeFile(path.join(out, 'agent.mjs'), AGENT(path.join(out, 'log')))
    await chmod(path.join(out, 'agent.mjs'), 0o755)
    AGENTS.hermes.command = path.join(out, 'agent.mjs')
    keepTrustIn(path.join(out, 'trusted.json'))
    setTrusted(root, true)
    const logged = async () => (await readFile(path.join(out, 'log'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
    const turn = async (id: string) => (await sendMessage(root, 'review', id, 'A quick one.', false, () => {})).finished

    // What Hermes offers, as the reader sees it: the name, and who serves it.
    assert.deepEqual(await listModels(), {
      current: 'custom:own',
      all: [
        { id: 'custom:own', name: 'own', from: 'custom' },
        { id: 'shop:big/model-1', name: 'big/model-1', from: 'Shop' }
      ]
    })

    const session = await startSession(root, 'review', 'hermes')
    await assert.rejects(tuneSession(root, 'review', session.id, '--yolo', null), /not a model/)
    await assert.rejects(tuneSession(root, 'review', session.id, null, 'hardest'), /not a thinking effort/)
    const claude = await startSession(root, 'review', 'claude')
    await assert.rejects(tuneSession(root, 'review', claude.id, 'shop:big/model-1', null), /Only Hermes/)

    // The agent that stays is told the model once, before its first turn with it.
    await tuneSession(root, 'review', session.id, 'shop:big/model-1', 'low')
    await turn(session.id)
    await turn(session.id)
    assert.deepEqual((await logged()).filter((each) => each.model), [{ model: 'shop:big/model-1' }])

    // The choice given back: the agent that was told a model is sent away, and a new one thinks with its own.
    const before = (await logged()).filter((each) => each.started).length
    const own = await tuneSession(root, 'review', session.id, null, null)
    assert.deepEqual([own.model, own.effort], [undefined, undefined])
    await turn(session.id)
    const after = await logged()
    assert.equal(after.filter((each) => each.started).length, before + 1)
    assert.equal(after.filter((each) => each.model).length, 1)

    // Started for one turn, as in a context that is not trusted, it is given both on its command line.
    setTrusted(root, false)
    await tuneSession(root, 'review', session.id, 'shop:big/model-1', 'low')
    await turn(session.id)
    assert.deepEqual((await logged()).filter((each) => each.started).at(-1)!.started.slice(-4), ['-m', 'shop:big/model-1', '--reasoning', 'low'])
  } finally {
    AGENTS.hermes.command = command
    await rm(root, { recursive: true, force: true })
    await rm(out, { recursive: true, force: true })
  }
})
