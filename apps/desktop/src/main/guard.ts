import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * The guard does not trust an agent to keep the rules. It looks at the folder.
 *
 * Before a turn it takes every file of the context. After the turn it compares. What changed
 * inside the open project is the agent's work, and the old bytes are kept so it can be put back.
 * What changed anywhere else is put back at once and held, until the reader approves that file.
 */

/** Every file of a context, by its path from the context folder, with forward slashes. */
export type Snapshot = Map<string, Buffer>

/** `before` is null for a file the agent made. `after` is null for a file it deleted. */
export type Change = { path: string; before: Buffer | null; after: Buffer | null }

/** The snapshot of the turn in progress, by context folder. One agent works in a context at a time. */
export const watching = new Map<string, Snapshot>()

/** Mate wrote this file itself while an agent was working. The guard must not take it for the agent's. */
export function mateWrote(contextDir: string, relative: string, bytes: Buffer | null): void {
  const snapshot = watching.get(contextDir)
  if (!snapshot) return
  if (bytes) snapshot.set(relative, bytes)
  else snapshot.delete(relative)
}

// ponytail: the whole context is held in memory for the length of a turn, and a file over this
// size is not watched. A context is documents. Hash the files and copy on change if that stops being true.
const MAX_BYTES = 5 * 1024 * 1024

/** Mate's own folders, and the bulk of git. `.git/hooks` and `.git/config` are watched: a hook written or pointed at would run later. */
const SKIPPED = new Set(['.sessions', '.indexes', '.git', 'node_modules', '.DS_Store'])

async function walk(contextDir: string, base: string, found: string[]): Promise<string[]> {
  const entries = await readdir(path.join(contextDir, base), { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (SKIPPED.has(entry.name)) continue
    const relative = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) await walk(contextDir, relative, found)
    else if (entry.isFile()) found.push(relative)
  }
  return found
}

export async function takeSnapshot(contextDir: string): Promise<Snapshot> {
  const snapshot: Snapshot = new Map()
  const files = await walk(contextDir, '', [])
  await walk(contextDir, '.git/hooks', files)
  // `core.hooksPath` here would send git to hooks the walk never sees. Only a real file counts.
  if ((await lstat(path.join(contextDir, '.git/config')).catch(() => null))?.isFile()) files.push('.git/config')
  // A project can be a repository of its own, brought in as it is. Its hooks and config are watched the same way.
  for (const project of await readdir(path.join(contextDir, 'projects')).catch(() => [])) {
    const git = `projects/${project}/.git`
    if (!(await lstat(path.join(contextDir, git)).catch(() => null))?.isDirectory()) continue
    await walk(contextDir, `${git}/hooks`, files)
    if ((await lstat(path.join(contextDir, git, 'config')).catch(() => null))?.isFile()) files.push(`${git}/config`)
  }
  for (const relative of files) {
    const file = path.join(contextDir, relative)
    if ((await stat(file)).size <= MAX_BYTES) snapshot.set(relative, await readFile(file))
  }
  return snapshot
}

/**
 * A snapshot as it is written down: a mark for each file, not the file. It says later which files
 * are no longer as they were. It cannot put one back.
 */
export const fingerprints = (snapshot: Snapshot): Record<string, string> =>
  Object.fromEntries([...snapshot].map(([file, bytes]) => [file, createHash('sha256').update(bytes).digest('hex').slice(0, 16)]))

/** What is different in the folder now. */
export async function changesSince(contextDir: string, before: Snapshot): Promise<Change[]> {
  const after = await takeSnapshot(contextDir)
  const changes: Change[] = []
  for (const relative of new Set([...before.keys(), ...after.keys()])) {
    const was = before.get(relative) ?? null
    const is = after.get(relative) ?? null
    if (was && is ? !was.equals(is) : was !== is) changes.push({ path: relative, before: was, after: is })
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * A path from a session file gets no trust: anyone can write one. Nothing absolute, no
 * backslashes, no empty or climbing parts, and where it lands must stay inside the context.
 */
export function insidePath(contextDir: string, relative: string): string {
  const parts = relative.split('/')
  if (path.isAbsolute(relative) || relative.includes('\\') || parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`That is not a file of this context: ${relative}`)
  }
  const file = path.resolve(contextDir, ...parts)
  const out = path.relative(contextDir, file)
  if (out === '' || out.startsWith('..') || path.isAbsolute(out)) throw new Error(`That path leaves the context: ${relative}`)
  return file
}

/** Make a file hold these bytes, or not exist. */
export async function put(contextDir: string, relative: string, bytes: Buffer | null): Promise<void> {
  const file = insidePath(contextDir, relative)
  if (bytes === null) return rm(file, { force: true })
  const dir = path.dirname(file)
  await mkdir(dir, { recursive: true })
  // Written beside the file and renamed over it, so a crash mid-restore never leaves half a file.
  const temporary = path.join(dir, `.${path.basename(file)}.${randomUUID()}.tmp`)
  await writeFile(temporary, bytes)
  await rename(temporary, file)
}
