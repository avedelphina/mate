import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { historyOf, versionAt } from '../src/main/git.ts'

// Git with a name to commit under, and nothing of the user's own setup.
const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.org', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.org' }
const git = (dir: string, ...args: string[]) => execFileSync('git', args, { cwd: dir, env, stdio: 'pipe' })

test("a file's history is read from git, and nothing the repository names is run to read it", async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-git-'))
  try {
    const file = path.join(root, 'config', 'sysmon.xml')
    await mkdir(path.dirname(file))
    git(root, 'init', '-q')
    await writeFile(file, '<Sysmon>\n  <ProcessCreate onmatch="exclude"/>\n</Sysmon>\n')
    git(root, 'add', '.')
    git(root, 'commit', '-q', '-m', 'First config')
    await writeFile(file, '<Sysmon>\n  <ProcessCreate onmatch="include"/>\n</Sysmon>\n')
    git(root, 'commit', '-q', '-am', 'Include process creation')
    await writeFile(file, '<Sysmon/>\n')

    // A repository can name programs for git to run on a file: a text conversion, an external diff.
    // Reading a version or the history must run neither.
    const ran = path.join(root, 'ran')
    await writeFile(path.join(root, '.gitattributes'), '*.xml diff=evil\n')
    git(root, 'config', 'diff.evil.textconv', `sh -c 'touch ${ran}; cat "$1"' -`)
    git(root, 'config', 'diff.external', `sh -c 'touch ${ran}'`)

    const commits = await historyOf(file, env)
    assert.deepEqual(
      commits.map((commit) => [commit.subject, commit.author]),
      [
        ['Include process creation', 'Ada'],
        ['First config', 'Ada']
      ]
    )
    assert.match(commits[0].hash, /^[0-9a-f]{40}$/)
    assert.equal(await versionAt(file, env, 'HEAD'), '<Sysmon>\n  <ProcessCreate onmatch="include"/>\n</Sysmon>\n')
    assert.equal(await versionAt(file, env, `${commits[0].hash}^`), '<Sysmon>\n  <ProcessCreate onmatch="exclude"/>\n</Sysmon>\n')
    // The first commit has no one before it, and a file git does not keep has no version.
    assert.equal(await versionAt(file, env, `${commits[1].hash}^`), null)
    await writeFile(path.join(root, 'notes.txt'), 'new\n')
    assert.equal(await versionAt(path.join(root, 'notes.txt'), env, 'HEAD'), null)
    assert.equal(existsSync(ran), false)

    // Only a commit's hash, that hash with ^, or HEAD is taken: nothing that git could read as an option.
    for (const bad of ['--output=/tmp/x', 'HEAD~1', 'main', 'abc def']) await assert.rejects(versionAt(file, env, bad), /not a commit/)
    // A file in no repository has no history.
    const outside = await mkdtemp(path.join(tmpdir(), 'mate-no-git-'))
    await writeFile(path.join(outside, 'a.txt'), 'a\n')
    assert.deepEqual(await historyOf(path.join(outside, 'a.txt'), env), [])
    await rm(outside, { recursive: true, force: true })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
