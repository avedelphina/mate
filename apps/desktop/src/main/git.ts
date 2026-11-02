import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'

/**
 * What Mate does with git, and it is not much. Git is the sync a context has, so Mate can start a
 * repository and put what has changed into a commit. It adds no remote. It fetches and pushes only
 * for the review of a pull request on a forge the reader added, when they press for it (forge.ts),
 * and pushes nothing but the reader's own commit, to that pull request's branch.
 *
 * Git starts programs a repository names: hooks, and whatever its config says. So it is run only
 * where that cannot be turned against the reader: to start a repository where there is none, and
 * otherwise in a context the reader trusts. Main checks that. See index.ts.
 */

const git = (dir: string, env: NodeJS.ProcessEnv, args: string[], input?: string) =>
  new Promise<string>((resolve, reject) => {
    const child = execFile('git', args, { cwd: dir, env, maxBuffer: 8 * 1024 * 1024 }, (failed, out, complaint) =>
      failed ? reject(new Error((complaint || out || failed.message).trim().slice(0, 600))) : resolve(out)
    )
    child.stdin?.end(input ?? '')
  })

/** Whether a folder is in a git repository. The folders are looked at. Git is not asked. */
export function inRepository(dir: string): boolean {
  for (let at = path.resolve(dir); ; at = path.dirname(at)) {
    if (existsSync(path.join(at, '.git'))) return true
    if (at === path.dirname(at)) return false
  }
}

/**
 * Make the context a git repository, so that it has a history and a way to another computer.
 * Only where there is no repository: git then reads nothing a context could have brought with
 * it, such as a hook or a config. Nothing is committed, and nothing connects anywhere.
 */
export async function startRepository(dir: string, env: NodeJS.ProcessEnv): Promise<void> {
  if (inRepository(dir)) throw new Error('This folder is in a git repository already.')
  await git(dir, env, ['init']).catch(() => {
    throw new Error('Git could not start a repository here. Is git on this computer?')
  })
}

/**
 * The projects that are repositories of their own, as git is told to leave them out. Their history
 * and their remote are theirs: a commit of the context does not take them in.
 */
async function ownRepositories(dir: string): Promise<string[]> {
  const projects = await readdir(path.join(dir, 'projects'), { withFileTypes: true }).catch(() => [])
  return projects.filter((each) => each.isDirectory() && existsSync(path.join(dir, 'projects', each.name, '.git'))).map((each) => `:(exclude)projects/${each.name}`)
}

/** How many files of the context differ from the last commit. A new file counts, an ignored one does not. */
export async function uncommitted(dir: string, env: NodeJS.ProcessEnv): Promise<number> {
  const said = await git(dir, env, ['status', '--porcelain', '--untracked-files=all', '--', '.', ...(await ownRepositories(dir))])
  return said.split('\n').filter(Boolean).length
}

/**
 * Put what has changed in the context into one commit, with the reader's words. Only the context:
 * in a repository that holds more, what else was changed or staged there is left as it was.
 * Gives the number of files the commit took.
 */
export async function commitContext(dir: string, message: string, env: NodeJS.ProcessEnv): Promise<number> {
  const said = String(message).trim()
  if (!said) throw new Error('Say what changed.')
  const changed = await uncommitted(dir, env)
  if (changed === 0) throw new Error('Nothing has changed since the last commit.')
  const leave = await ownRepositories(dir)
  await git(dir, env, ['add', '--all', '--', '.', ...leave])
  // The words are one value, whatever they begin with.
  await git(dir, env, ['commit', `--message=${said}`, '--', '.', ...leave])
  return changed
}

/** A commit that changed a file. `date` is ISO 8601. */
export type Commit = { hash: string; author: string; date: string; subject: string }

/**
 * The commits that changed a file, the newest first, from the repository the file is in: a project
 * that is a repository of its own answers for its own files. Only `git log`, which runs no diff
 * program and no hook. Main asks it only in a context the reader trusts, as for a commit.
 */
export async function historyOf(full: string, env: NodeJS.ProcessEnv): Promise<Commit[]> {
  if (!inRepository(full)) return []
  const out = await git(path.dirname(full), env, ['log', '--max-count=200', '--format=%H%x09%an%x09%aI%x09%s', '--', path.basename(full)])
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, author, date, ...subject] = line.split('\t')
      return { hash, author, date, subject: subject.join('\t') }
    })
}

/**
 * A file as a commit had it, or null when that commit did not have it. `git cat-file` gives the
 * bytes as they are stored, with no filter and no text conversion, so nothing a repository names runs.
 * `rev` is a commit's hash, that hash with `^` for the one before it, or HEAD.
 */
export async function versionAt(full: string, env: NodeJS.ProcessEnv, rev: string): Promise<string | null> {
  if (!/^(?:[0-9a-f]{7,64}\^?|HEAD)$/.test(rev)) throw new Error('That is not a commit.')
  if (!inRepository(full)) return null
  return git(path.dirname(full), env, ['cat-file', 'blob', `${rev}:./${path.basename(full)}`]).catch(() => null)
}

/**
 * The files of a repository that differ from its last commit, by their path in it. A file git does
 * not keep is left out: it goes with the reader from one branch to the next and is lost by none.
 */
export async function changedIn(dir: string, env: NodeJS.ProcessEnv): Promise<string[]> {
  const said = await git(dir, env, ['status', '--porcelain', '--untracked-files=no', '-z'])
  return said.split('\0').filter(Boolean).map((line) => line.slice(3))
}

/** The branch the repository is on, or the commit when it is on none. */
export async function whereIs(dir: string, env: NodeJS.ProcessEnv): Promise<string> {
  const branch = (await git(dir, env, ['symbolic-ref', '--short', '-q', 'HEAD']).catch(() => '')).trim()
  return branch || (await git(dir, env, ['rev-parse', 'HEAD'])).trim()
}

// A remote that asks for a password fails at once. There is no terminal to type it in.
const quiet = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({ ...env, GIT_TERMINAL_PROMPT: '0' })

/**
 * Fetch the last commit of a pull request from `origin`, where a forge such as Gitea keeps it as
 * refs/pull/N/head, and gives its hash. Only on the reader's press, in a context they trust.
 */
export async function fetchPull(dir: string, env: NodeJS.ProcessEnv, number: number): Promise<string> {
  if (!Number.isInteger(number) || number < 1) throw new Error('That is not a pull request.')
  await git(dir, quiet(env), ['fetch', '--no-tags', 'origin', `refs/pull/${number}/head`]).catch((failed: Error) => {
    throw new Error(`Git could not fetch pull request #${number} from origin. ${failed.message}`)
  })
  return (await git(dir, env, ['rev-parse', 'FETCH_HEAD'])).trim()
}

/** Check out a commit, on no branch, or a branch by its name. Git refuses when that would lose a change. */
export async function switchTo(dir: string, env: NodeJS.ProcessEnv, target: string): Promise<void> {
  const commit = /^[0-9a-f]{40,64}$/.test(target)
  if (!commit && !/^[\w][\w./-]*$/.test(target)) throw new Error('That is not a branch.')
  await git(dir, env, commit ? ['switch', '--detach', target] : ['switch', target])
}

/** Bring a branch that is checked out up to `origin`'s, when only that is new. Gives whether it moved. */
export async function fastForward(dir: string, env: NodeJS.ProcessEnv, branch: string): Promise<boolean> {
  if (!/^[\w][\w./-]*$/.test(branch)) throw new Error('That is not a branch.')
  await git(dir, quiet(env), ['fetch', '--no-tags', 'origin', branch])
  const before = (await git(dir, env, ['rev-parse', 'HEAD'])).trim()
  await git(dir, env, ['merge', '--ff-only', 'FETCH_HEAD']).catch(() => '')
  return (await git(dir, env, ['rev-parse', 'HEAD'])).trim() !== before
}

/**
 * Commit these texts of files git keeps on top of the commit checked out, with the reader's words,
 * and give the new commit's hash. Only the index is given them: the files on disk, with the review's
 * comments in them, stay as they are. The texts are stored as given, with no filter of the repository.
 */
export async function commitTexts(dir: string, env: NodeJS.ProcessEnv, texts: { path: string; text: string }[], message: string): Promise<string> {
  const said = String(message).trim()
  if (!said) throw new Error('Say what changed.')
  for (const { path: where, text } of texts) {
    const mode = (await git(dir, env, ['ls-files', '--stage', '--', where])).split(' ')[0]
    if (!/^100(644|755)$/.test(mode)) throw new Error(`${where} is not a file git keeps here.`)
    const blob = (await git(dir, env, ['hash-object', '-w', '--no-filters', '--stdin'], text)).trim()
    await git(dir, env, ['update-index', '--cacheinfo', `${mode},${blob},${where}`])
  }
  // A hook may refuse the commit. The index is then as it was, and nothing waits staged.
  await git(dir, env, ['commit', `--message=${said}`]).catch(async (failed: Error) => {
    await git(dir, env, ['reset', '--quiet']).catch(() => '')
    throw new Error(`Git did not commit. ${failed.message}`)
  })
  return (await git(dir, env, ['rev-parse', 'HEAD'])).trim()
}

/** Take a commit that was not pushed back off: what is checked out is that commit again, and the files on disk stay as they are. */
export async function undoCommit(dir: string, env: NodeJS.ProcessEnv, to: string): Promise<void> {
  if (!/^[0-9a-f]{40,64}$/.test(to)) throw new Error('That is not a commit.')
  await git(dir, env, ['reset', '--quiet', '--mixed', to])
}

/** Push what is checked out to one branch of `origin`, as a fast-forward only: never with force. */
export async function pushTo(dir: string, env: NodeJS.ProcessEnv, branch: string): Promise<void> {
  if (!/^[\w][\w./-]*$/.test(branch)) throw new Error('That is not a branch.')
  await git(dir, quiet(env), ['push', '--no-tags', 'origin', `HEAD:refs/heads/${branch}`]).catch((failed: Error) => {
    throw new Error(`Git could not push to ${branch}. ${/rejected|fetch first|non-fast-forward/.test(failed.message) ? 'The branch has commits you do not have yet: press Review again to have them.' : failed.message}`)
  })
}
