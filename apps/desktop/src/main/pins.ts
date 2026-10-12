import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { changedParts, diffLines } from '../shared/diff'

/**
 * Instruction files are what an agent takes as its orders before it reads anything else. The
 * agents load `AGENTS.md` and its like themselves, from the folder they work in. So whoever can
 * change one steers the agent: a pulled commit, a cloned repository, or the agent itself, leaving
 * a note for its next turn.
 *
 * Mate keeps what the reader approved, outside the context, and asks again when any of it is
 * new, changed, or gone. It is checked before every turn, so a file the agent wrote during one
 * turn is shown to the reader before the next.
 */

/** The names Hermes, Codex and Claude Code read as instructions. `.cursor/rules/*.mdc` is found apart. */
const NAMES = new Set(['AGENTS.md', 'AGENTS.override.md', 'HERMES.md', '.hermes.md', 'CLAUDE.md', '.cursorrules'])
const SKIPPED = new Set(['.git', '.sessions', '.indexes', 'node_modules'])
// ponytail: the walk stops at this depth and this many folders, and a file over this size is pinned
// by its first part only. A context is documents.
const MAX_DEPTH = 6
const MAX_FOLDERS = 5000
const MAX_BYTES = 256 * 1024

/** A file that is new, changed, or gone since the reader last approved. `null` is "not there". */
export type Changed = { path: string; was: string | null; is: string | null }

/** Every instruction file of a context, by its path from the context folder, with what it says. */
export async function instructionFiles(contextDir: string): Promise<Record<string, string>> {
  const found: Record<string, string> = {}
  let folders = 0
  const walk = async (base: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || ++folders > MAX_FOLDERS) return
    const entries = await readdir(path.join(contextDir, base), { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const relative = base ? `${base}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        // Hidden folders hold nothing an agent reads as orders, but for the rules of Cursor.
        if (SKIPPED.has(entry.name) || (entry.name.startsWith('.') && entry.name !== '.cursor')) continue
        await walk(relative, depth + 1)
        continue
      }
      const rule = base.endsWith('.cursor/rules') && entry.name.endsWith('.mdc')
      if (!NAMES.has(entry.name) && !rule) continue
      // A link is read through, as the agent reads through it. What it says is what counts.
      const text = await readFile(path.join(contextDir, relative), 'utf8').catch(() => null)
      if (text !== null) found[relative] = text.slice(0, MAX_BYTES)
    }
  }
  await walk('', 0)
  return found
}

let file: string | null = null
let pinned: Record<string, Record<string, string>> = {}

function real(contextDir: string): string {
  try {
    return realpathSync(contextDir)
  } catch {
    return contextDir
  }
}

/** Where the approved files are kept. Outside every context: a context cannot approve itself. */
export function keepPinsIn(where: string): void {
  file = where
  try {
    const kept: unknown = JSON.parse(readFileSync(where, 'utf8'))
    pinned = kept && typeof kept === 'object' && !Array.isArray(kept) ? (kept as typeof pinned) : {}
  } catch {
    pinned = {}
  }
}

/** What differs from what the reader approved for this context. Nothing was approved at first. */
export function unapproved(contextDir: string, now: Record<string, string>): Changed[] {
  const was = pinned[real(contextDir)] ?? {}
  return [...new Set([...Object.keys(was), ...Object.keys(now)])]
    .sort()
    .filter((each) => was[each] !== now[each])
    .map((each) => ({ path: each, was: was[each] ?? null, is: now[each] ?? null }))
}

export function approve(contextDir: string, now: Record<string, string>): void {
  pinned[real(contextDir)] = now
  if (file) writeFileSync(file, JSON.stringify(pinned), { mode: 0o600 })
}

/** The changes, as the reader is shown them before an agent starts. Long files are cut short. */
export function describe(changes: Changed[], most = 14): string {
  return changes
    .map((change) => {
      if (change.is === null) return `${change.path}: removed`
      const lines = changedParts(diffLines(change.was ?? '', change.is), 1).map((line) => `${line.kind} ${line.text}`.trimEnd())
      const shown = lines.slice(0, most)
      if (lines.length > most) shown.push(`… and ${lines.length - most} more lines`)
      return `${change.path}: ${change.was === null ? 'new' : 'changed'}\n${shown.join('\n')}`
    })
    .join('\n\n')
}
