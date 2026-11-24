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

/** The snapshots of the turns in progress, by context folder. More than one when agents work on different projects at once. */
export const watching = new Map<string, Set<Snapshot>>()

export function watch(contextDir: string, snapshot: Snapshot): void {
  const here = watching.get(contextDir) ?? new Set<Snapshot>()
  here.add(snapshot)
  watching.set(contextDir, here)
}

export function unwatch(contextDir: string, snapshot: Snapshot | undefined): void {
  const here = watching.get(contextDir)
  if (!here || !snapshot) return
  here.delete(snapshot)
  if (here.size === 0) watching.delete(contextDir)
}

/**
 * Mate wrote this file itself while an agent was working: the reader, or the guard of another agent that has just
 * finished. Every turn in progress is told, so that none takes it for its own agent's.
 */
export function mateWrote(contextDir: string, relative: string, bytes: Buffer | null): void {
  for (const snapshot of watching.get(contextDir) ?? []) {
    if (bytes) snapshot.set(relative, bytes)
    else snapshot.delete(relative)
  }
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

/** What the folder said of a file when it was read. A file read again only when it says something else. */
type Mark = { size: number; mtime: number; ctime: number }
const marks = new WeakMap<Snapshot, Map<string, Mark>>()
const takenAt = new WeakMap<Snapshot, number>()

// ponytail: a file whose size, modification time and change time are as they were is taken to be as it was, and is not read again.
// A file written again within the granularity of the time stamp to a text of the same size would be missed, so a file stamped within
// this window of the moment it was read is always read again. A share whose clock is far from this computer's can hide such a file.
// Read every file again when that is a problem.
const WINDOW = 5000
/** At the most this many files are read at once, so a share is not asked for thousands of files in one breath. */
const AT_ONCE = 16

/** The latest snapshot of each context, kept for a while so that the next one reads only what changed. */
const recent = new Map<string, Snapshot>()
const KEPT_BYTES = 512 * 1024 * 1024
const KEPT_FOR = 10 * 60 * 1000
const forgetting = new Map<string, NodeJS.Timeout>()

function keep(contextDir: string, snapshot: Snapshot): void {
  let total = 0
  for (const bytes of snapshot.values()) total += bytes.length
  clearTimeout(forgetting.get(contextDir))
  if (total > KEPT_BYTES) return void recent.delete(contextDir)
  recent.set(contextDir, snapshot)
  forgetting.set(contextDir, setTimeout(() => (recent.delete(contextDir), forgetting.delete(contextDir)), KEPT_FOR).unref())
}

/**
 * Every file of the context, as it is. Reading is what costs, on a network share most of all, so a file that the
 * folder says is as it was in `known` (by default the latest snapshot of this context) is not read again.
 */
export async function takeSnapshot(contextDir: string, known: Snapshot | undefined = recent.get(contextDir)): Promise<Snapshot> {
  const snapshot: Snapshot = new Map()
  const here = new Map<string, Mark>()
  const before = known && marks.get(known)
  const when = Date.now()
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
  const one = async (relative: string): Promise<void> => {
    const file = path.join(contextDir, relative)
    const info = await stat(file).catch(() => null)
    if (!info || info.size > MAX_BYTES) return
    const mark = { size: info.size, mtime: info.mtimeMs, ctime: info.ctimeMs }
    const was = before?.get(relative)
    const same = was && was.size === mark.size && was.mtime === mark.mtime && was.ctime === mark.ctime && mark.mtime > 0
    // Stamped near the moment it was read, a file may still be written again to the same stamp.
    const settled = same && Math.abs((takenAt.get(known!) ?? 0) - mark.mtime) > WINDOW
    here.set(relative, mark)
    snapshot.set(relative, settled && known!.has(relative) ? known!.get(relative)! : await readFile(file))
  }
  for (let at = 0; at < files.length; at += AT_ONCE) await Promise.all(files.slice(at, at + AT_ONCE).map(one))
  marks.set(snapshot, here)
  takenAt.set(snapshot, when)
  keep(contextDir, snapshot)
  return snapshot
}

/**
 * A snapshot as it is written down: a mark for each file, not the file. It says later which files
 * are no longer as they were. It cannot put one back.
 */
const hashed = new WeakMap<Buffer, string>()
export const fingerprints = (snapshot: Snapshot): Record<string, string> =>
  Object.fromEntries(
    [...snapshot].map(([file, bytes]) => {
      // The same bytes, kept from one snapshot to the next, are hashed once.
      const kept = hashed.get(bytes) ?? createHash('sha256').update(bytes).digest('hex').slice(0, 16)
      hashed.set(bytes, kept)
      return [file, kept]
    })
  )

/** What is different in the folder now. */
export async function changesSince(contextDir: string, before: Snapshot): Promise<Change[]> {
  // Only what the folder says has changed since `before` is read again.
  const after = await takeSnapshot(contextDir, before)
  const changes: Change[] = []
  for (const relative of new Set([...before.keys(), ...after.keys()])) {
    const was = before.get(relative) ?? null
    const is = after.get(relative) ?? null
    if (was && is ? was !== is && !was.equals(is) : was !== is) changes.push({ path: relative, before: was, after: is })
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
