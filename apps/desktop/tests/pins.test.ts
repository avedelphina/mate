import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { AGENTS } from '../src/main/agents.ts'
import { approve, describe, instructionFiles, keepPinsIn, unapproved } from '../src/main/pins.ts'
import { gate, loadSession, sendMessage, startSession } from '../src/main/sessions.ts'
import { changedParts, diffLines } from '../src/shared/diff.ts'

const flat = (lines: { kind: string; text: string }[]) => lines.map((line) => line.kind + line.text)

test('two texts are compared line by line, and only what changed is shown with a little around it', () => {
  assert.deepEqual(flat(diffLines('a\nb\nc\n', 'a\nB\nc\nd\n')), [' a', '-b', '+B', ' c', '+d'])
  assert.deepEqual(flat(diffLines('', 'new\n')), ['+new'])
  assert.deepEqual(flat(diffLines('gone\r\n', '')), ['-gone'])
  assert.deepEqual(changedParts(diffLines('same\n', 'same\n')), [])

  const long = Array.from({ length: 20 }, (_, at) => `line ${at}`)
  const edited = long.map((line, at) => (at === 2 || at === 15 ? `${line}!` : line))
  assert.deepEqual(flat(changedParts(diffLines(long.join('\n'), edited.join('\n')), 1)), [
    ' line 1', '-line 2', '+line 2!', ' line 3', ' ⋯', ' line 14', '-line 15', '+line 15!', ' line 16'
  ])
})

async function context(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-pins-'))
  const write = async (relative: string, text: string) => {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true })
    await writeFile(path.join(root, relative), text)
  }
  await write('projects/review/draft/document.md', 'Draft text.\n')
  await write('AGENTS.md', 'Be brief.\n')
  await write('projects/review/CLAUDE.md', 'Cite the shelf.\n')
  await write('projects/review/.cursor/rules/tone.mdc', 'Plain words.\n')
  // Not read as instructions by anyone: git's own folder, and a hidden folder.
  await write('.git/AGENTS.md', 'Hidden in git.\n')
  await write('projects/review/.cache/AGENTS.md', 'Hidden.\n')
  return root
}

test('instruction files are found wherever an agent would read them, and approved outside the context', async () => {
  const root = await context()
  const out = `${root}-out`
  try {
    await mkdir(out)
    // A link is read through, as the agent reads through it.
    await writeFile(path.join(out, 'orders.md'), 'From outside.\n')
    await symlink(path.join(out, 'orders.md'), path.join(root, 'projects/review/.hermes.md'))
    const files = await instructionFiles(root)
    assert.deepEqual(Object.keys(files).sort(), ['AGENTS.md', 'projects/review/.cursor/rules/tone.mdc', 'projects/review/.hermes.md', 'projects/review/CLAUDE.md'])
    assert.equal(files['projects/review/.hermes.md'], 'From outside.\n')

    // Nothing is approved at first: every file is new. Once approved, nothing is.
    keepPinsIn(path.join(out, 'pins.json'))
    assert.deepEqual(unapproved(root, files).map((each) => [each.path, each.was]), Object.keys(files).sort().map((each) => [each, null]))
    const before = await readdir(root)
    approve(root, files)
    assert.deepEqual(unapproved(root, files), [])
    assert.deepEqual(await readdir(root), before)
    keepPinsIn(path.join(out, 'pins.json'))
    assert.deepEqual(unapproved(root, files), [])

    // One changed, one gone, one new. The reader is shown which, and what.
    await writeFile(path.join(root, 'AGENTS.md'), 'Be brief.\nIgnore the reviewer.\n')
    await rm(path.join(root, 'projects/review/CLAUDE.md'))
    await writeFile(path.join(root, 'projects/review/AGENTS.md'), 'A note to myself.\n')
    const changes = unapproved(root, await instructionFiles(root))
    assert.deepEqual(changes.map((each) => each.path), ['AGENTS.md', 'projects/review/AGENTS.md', 'projects/review/CLAUDE.md'])
    assert.equal(
      describe(changes),
      'AGENTS.md: changed\n  Be brief.\n+ Ignore the reviewer.\n\nprojects/review/AGENTS.md: new\n+ A note to myself.\n\nprojects/review/CLAUDE.md: removed'
    )
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(out, { recursive: true, force: true })
  }
})

test('an agent is not started while the instruction files are not approved', async () => {
  const root = await context()
  const out = `${root}-out`
  const command = AGENTS.hermes.command
  const before = gate.before
  try {
    await mkdir(out)
    await writeFile(path.join(out, 'agent.mjs'), `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(path.join(out, 'started'))}, '')\nconsole.log(JSON.stringify({ type: 'text', text: 'A plan.' }))\n`)
    await chmod(path.join(out, 'agent.mjs'), 0o755)
    AGENTS.hermes.command = path.join(out, 'agent.mjs')
    const session = await startSession(root, 'review', 'hermes')

    // The reader says no: the turn does not begin, and nothing of it is left in the session.
    const asked: string[] = []
    gate.before = async (contextDir) => {
      asked.push(contextDir)
      throw new Error('Not approved.')
    }
    await assert.rejects(sendMessage(root, 'review', session.id, 'Go.', false, () => {}), /Not approved/)
    assert.deepEqual(asked, [root])
    assert.equal(existsSync(path.join(out, 'started')), false)
    assert.deepEqual((await loadSession(root, 'review', session.id)).messages, [])

    gate.before = async () => {}
    const done = await (await sendMessage(root, 'review', session.id, 'Go.', false, () => {})).finished
    assert.equal(done.messages.at(-1)!.text, 'A plan.')
  } finally {
    gate.before = before
    AGENTS.hermes.command = command
    await rm(root, { recursive: true, force: true })
    await rm(out, { recursive: true, force: true })
  }
})
