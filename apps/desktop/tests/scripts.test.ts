import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { runScript, stopScript, wordsOf } from '../src/main/scripts.ts'
import { keepTrustIn, setTrusted } from '../src/main/trust.ts'

test('a line is the script and what it is given, with quotes around a word that has a space', () => {
  assert.deepEqual(wordsOf('scripts/extract.py dropbox/letter.docx'), ['scripts/extract.py', 'dropbox/letter.docx'])
  assert.deepEqual(wordsOf('  scripts/x.sh  "two words.docx"   --all '), ['scripts/x.sh', 'two words.docx', '--all'])
  assert.deepEqual(wordsOf(''), [])
})

test('a script of a trusted project is run as the line says, with no agent and no shell', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-scripts-'))
  const out = `${root}-out`
  try {
    await mkdir(path.join(root, 'projects/review/scripts'), { recursive: true })
    await mkdir(path.join(root, 'projects/review/draft'))
    await mkdir(out)
    const script = (name: string, text: string) => writeFile(path.join(root, 'projects/review/scripts', name), text)
    await script('note.sh', 'echo "given: $1 | $2"\necho "to stderr" >&2\necho made > draft/made.md\n')
    await script('fail.py', 'import sys\nprint("before it fails")\nsys.exit(3)\n')
    await script('slow.sh', 'echo started\nsleep 30\n')
    await script('words.mjs', 'console.log(process.argv.slice(2).length)\n')
    await writeFile(path.join(out, 'outside.sh'), 'echo outside\n')
    await symlink(path.join(out, 'outside.sh'), path.join(root, 'projects/review/scripts/link.sh'))
    keepTrustIn(path.join(out, 'trusted.json'))

    // Not in a context the reader has not trusted: a script is a program with the reader's rights.
    await assert.rejects(runScript(root, 'review', 'scripts/note.sh a b'), /only in a context you trust/)
    setTrusted(root, true)

    // It runs in the project folder, gets its words as they are, and what it prints comes back.
    const ran = await runScript(root, 'review', 'scripts/note.sh "two words" $(whoami)')
    assert.deepEqual([ran.code, ran.stopped, ran.output], [0, false, 'given: two words | $(whoami)\nto stderr\n'])
    assert.equal(await readFile(path.join(root, 'projects/review/draft/made.md'), 'utf8'), 'made\n')
    assert.equal((await runScript(root, 'review', 'scripts/words.mjs a "b c" d')).output, '3\n')

    // A script that fails says so, with what it printed.
    const failed = await runScript(root, 'review', 'scripts/fail.py')
    assert.deepEqual([failed.code, failed.output], [3, 'before it fails\n'])

    // Only a file in scripts/ of this project. Not a path out of it, not a hidden one, not a link out of the context.
    for (const line of ['draft/made.md', 'scripts/../draft/made.md', 'scripts/.hidden.sh', '/bin/echo hi', 'scripts', '']) {
      await assert.rejects(runScript(root, 'review', line), /Only a script in the scripts folder/)
    }
    await assert.rejects(runScript(root, 'review', 'scripts/link.sh'), /leaves the context/)
    await assert.rejects(runScript(root, 'review', 'scripts/missing.sh'))

    // One at a time, and a script that runs too long is stopped. So is one the reader stops.
    // Time enough for the script to start and print, also when the computer is busy with the other tests.
    const slow = runScript(root, 'review', 'scripts/slow.sh', 2)
    await assert.rejects(runScript(root, 'review', 'scripts/note.sh'), /A script is running/)
    assert.deepEqual([(await slow).stopped, (await slow).output], [true, 'started\n'])
    const stopped = runScript(root, 'review', 'scripts/slow.sh')
    setTimeout(() => stopScript(root), 1000)
    assert.equal((await stopped).stopped, true)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(out, { recursive: true, force: true })
  }
})
