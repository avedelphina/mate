import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'

/**
 * What Mate does with git, and it is not much. Git is the sync a context has, so Mate can start a
 * repository and put what has changed into a commit. It adds no remote, and it never pushes or pulls.
 *
 * Git starts programs a repository names: hooks, and whatever its config says. So it is run only
 * where that cannot be turned against the reader: to start a repository where there is none, and
 * otherwise in a context the reader trusts. Main checks that. See index.ts.
 */

const git = (dir: string, env: NodeJS.ProcessEnv, args: string[]) =>
  new Promise<string>((resolve, reject) =>
    execFile('git', args, { cwd: dir, env, maxBuffer: 8 * 1024 * 1024 }, (failed, out, complaint) =>
      failed ? reject(new Error((complaint || out || failed.message).trim().slice(0, 600))) : resolve(out)
    )
  )

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
