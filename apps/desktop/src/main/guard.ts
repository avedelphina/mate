import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
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

/** Mate's own folders, and the bulk of git. `.git/hooks` is watched: a hook written there would run later. */
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
  for (const relative of files) {
    const file = path.join(contextDir, relative)
    if ((await stat(file)).size <= MAX_BYTES) snapshot.set(relative, await readFile(file))
  }
  return snapshot
}

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

/** Make a file hold these bytes, or not exist. */
export async function put(contextDir: string, relative: string, bytes: Buffer | null): Promise<void> {
  const file = path.join(contextDir, ...relative.split('/'))
  if (bytes === null) return rm(file, { force: true })
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, bytes)
}
