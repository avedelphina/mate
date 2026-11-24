import { createHash } from 'node:crypto'
import { constants, existsSync } from 'node:fs'
import { copyFile, lstat, mkdir, readFile, readdir, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { inRepository, projectFiles } from './git'

/**
 * A session may work on a copy of its project, outside the context. The agent works in the copy, so
 * everything that changes there is its work and nothing else is. See docs/session-copies.md.
 *
 * The copy is laid out like a context, so the paths an agent is told still hold:
 *
 *   <copies>/<context>/<session>/projects/<project>/   the copy: where the agent works
 *   <copies>/<context>/<session>/{shelf,.mate,...}     links to the real context
 *
 * It is a helper that can be deleted: what the agent did was put back into the project at the end of each turn.
 */

/** A project over either limit is not copied, and works in place. */
export const MAX_COPY_FILES = 20_000
export const MAX_COPY_BYTES = 1024 * 1024 * 1024

let root: string | null = null

/** Where the copies are kept: a folder of Mate's own, outside every context. */
export function keepCopiesIn(dir: string): void {
  root = dir
}

const here = () => {
  if (!root) throw new Error('Mate has no place to keep a copy.')
  return root
}

const contextKey = (contextDir: string) => createHash('sha256').update(path.resolve(contextDir)).digest('hex').slice(0, 12)

/** The folder of one session's copy. */
export const copyOf = (contextDir: string, id: string): string => {
  if (!/^[\w-]+$/.test(id)) throw new Error('That is not a session.')
  return path.join(here(), contextKey(contextDir), id)
}

/** What the folder said of a file when it was copied, and of the copy. A file is copied again only when one of them differs. */
type Seen = { size: number; mtime: number; ctime: number; copySize: number; copyMtime: number }
const manifestOf = (contextDir: string, id: string) => `${copyOf(contextDir, id)}.json`

/** The entries of a context that the agent reads through links. The project itself is the copy. */
const LINKED = ['shelf', 'templates', '.indexes', '.mate', 'intents.md', 'principles.md']

/** Whether a project can be copied: a repository, as far as the folders say. Git is not asked. */
export const copyable = (projectDir: string): boolean => existsSync(path.join(projectDir, '.git')) || inRepository(projectDir)

/**
 * Bring the copy up to date with the project, and give back the folder the agent works in. A file that changed in the
 * project, or that the agent left different in the copy, is copied again. A file no longer in the project goes from the copy.
 * Clones are used where the disk has them, so a copy costs no space there.
 */
export async function prepareCopy(contextDir: string, project: string, id: string, env: NodeJS.ProcessEnv): Promise<string> {
  const projectDir = path.join(contextDir, 'projects', project)
  const dir = copyOf(contextDir, id)
  const work = path.join(dir, 'projects', project)
  await mkdir(work, { recursive: true })

  const listed = (await projectFiles(projectDir, env)).filter((file) => !file.split('/').includes('.git'))
  // Files git ignores that the agent needs, such as a local config, are named in .worktreeinclude: the list Claude Code and
  // Hermes read for their own worktrees. A name is a file or a folder of the project. Nothing outside the project is taken.
  for (const entry of await includeList(projectDir)) {
    for (const file of await filesUnder(projectDir, entry)) if (!listed.includes(file) && !file.split('/').includes('.git')) listed.push(file)
  }
  if (listed.length > MAX_COPY_FILES) throw new Error(`This project has ${listed.length} files. A copy holds at most ${MAX_COPY_FILES}. Work in place.`)

  const manifestFile = manifestOf(contextDir, id)
  const before: Record<string, Seen> = await readFile(manifestFile, 'utf8').then((text) => JSON.parse(text), () => ({}))
  const after: Record<string, Seen> = {}
  let bytes = 0
  const one = async (file: string): Promise<void> => {
    const from = path.join(projectDir, file)
    const info = await lstat(from).catch(() => null)
    // A link could lead out of the project, and a folder (a submodule) is not a file. Neither is copied.
    if (!info?.isFile()) return
    bytes += info.size
    const to = path.join(work, file)
    const was = before[file]
    const there = await stat(to).catch(() => null)
    const same = was && there && was.size === info.size && was.mtime === info.mtimeMs && was.ctime === info.ctimeMs && was.copySize === there.size && was.copyMtime === there.mtimeMs
    if (!same) {
      await mkdir(path.dirname(to), { recursive: true })
      await rm(to, { force: true })
      await copyFile(from, to, constants.COPYFILE_FICLONE)
    }
    const now = same ? there : await stat(to)
    after[file] = { size: info.size, mtime: info.mtimeMs, ctime: info.ctimeMs, copySize: now.size, copyMtime: now.mtimeMs }
  }
  for (let at = 0; at < listed.length; at += 16) await Promise.all(listed.slice(at, at + 16).map(one))
  if (bytes > MAX_COPY_BYTES) throw new Error(`This project is ${Math.round(bytes / 1024 / 1024)} MB. A copy holds at most ${MAX_COPY_BYTES / 1024 / 1024} MB. Work in place.`)

  // What the project no longer has, or never had, is not in the copy.
  const keep = new Set(Object.keys(after))
  const walk = async (base: string): Promise<void> => {
    for (const entry of await readdir(path.join(work, base), { withFileTypes: true }).catch(() => [])) {
      const relative = base ? `${base}/${entry.name}` : entry.name
      if (entry.isDirectory()) await walk(relative)
      else if (!keep.has(relative)) await rm(path.join(work, relative), { force: true })
    }
  }
  await walk('')
  await writeFile(manifestFile, JSON.stringify(after))

  await link(contextDir, project, dir)
  return work
}

/** The entries of the project's `.worktreeinclude`: one path in a line, blank lines and # comments left out. */
async function includeList(projectDir: string): Promise<string[]> {
  const text = await readFile(path.join(projectDir, '.worktreeinclude'), 'utf8').catch(() => '')
  return text.split('\n').map((line) => line.trim().replace(/^\.?\//, '').replace(/\/+$/, '')).filter((line) => line && !line.startsWith('#') && !line.split('/').some((part) => part === '..'))
}

/** The files of the project at a path in it: the file, or every file in the folder. A link is not followed. */
async function filesUnder(projectDir: string, relative: string): Promise<string[]> {
  const info = await lstat(path.join(projectDir, relative)).catch(() => null)
  if (info?.isFile()) return [relative]
  if (!info?.isDirectory()) return []
  const found: string[] = []
  for (const entry of await readdir(path.join(projectDir, relative))) found.push(...(await filesUnder(projectDir, `${relative}/${entry}`)))
  return found
}

/** The links the agent reads the context by: what is shared, and the other projects. They lead to the real context. */
async function link(contextDir: string, project: string, dir: string): Promise<void> {
  const real = path.resolve(contextDir)
  const want = new Map<string, string>()
  for (const name of LINKED) if (existsSync(path.join(real, name))) want.set(name, path.join(real, name))
  await mkdir(path.join(dir, 'projects'), { recursive: true })
  for (const other of await readdir(path.join(real, 'projects')).catch(() => [])) {
    if (other !== project && !other.startsWith('.')) want.set(`projects/${other}`, path.join(real, 'projects', other))
  }
  for (const [name, target] of want) {
    const at = path.join(dir, name)
    const now = await readlink(at).catch(() => null)
    if (now === target) continue
    await rm(at, { recursive: false, force: true }).catch(() => {})
    await symlink(target, at)
  }
  // A project that is gone, or a link that is not wanted any more.
  for (const name of await readdir(path.join(dir, 'projects')).catch(() => [])) {
    const at = path.join(dir, 'projects', name)
    if (name !== project && !want.has(`projects/${name}`) && (await lstat(at).catch(() => null))?.isSymbolicLink()) await rm(at, { force: true })
  }
}

/** Delete a session's copy. Only the copy goes: a link is taken away and never followed. */
export async function removeCopy(contextDir: string, id: string): Promise<void> {
  const dir = copyOf(contextDir, id)
  // `rm` removes a link as a link and does not follow it into the context.
  await rm(dir, { recursive: true, force: true })
  await rm(manifestOf(contextDir, id), { force: true })
}
