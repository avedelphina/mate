import { readFileSync, writeFileSync } from 'node:fs'

/**
 * What the reader is shown once after an update: the sections of CHANGELOG.md for the versions
 * since the one they last saw. The version they saw is kept in a file of Mate's own, outside every
 * context, like the list of recent ones.
 */
export type Entry = { version: string; date: string; body: string }

const newer = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true }) > 0

/** The released sections of a changelog, newest first as written. `Unreleased` is not one. */
export function entriesOf(changelog: string): Entry[] {
  const found: Entry[] = []
  const heading = /^## \[([^\]]+)\](?: - (\S+))?[ \t]*$/gm
  const marks = [...changelog.matchAll(heading)]
  marks.forEach((mark, at) => {
    const end = at + 1 < marks.length ? marks[at + 1].index : changelog.length
    found.push({ version: mark[1], date: mark[2] ?? '', body: changelog.slice(mark.index + mark[0].length, end).trim() })
  })
  return found
}

/** The sections after `seen`, up to and including `now`. */
export const notesSince = (changelog: string, seen: string, now: string): Entry[] =>
  entriesOf(changelog).filter((each) => newer(each.version, seen) && !newer(each.version, now))

let file: string | null = null
let seen: string | null = null

/** Where the version last seen is kept. A file that is missing or damaged says nothing was seen. */
export function keepSeenIn(where: string): void {
  file = where
  try {
    const kept: unknown = JSON.parse(readFileSync(where, 'utf8'))
    seen = typeof kept === 'object' && kept && typeof (kept as { version?: unknown }).version === 'string' ? (kept as { version: string }).version : null
  } catch {
    seen = null
  }
}

export function markSeen(version: string): void {
  seen = version
  if (file) writeFileSync(file, JSON.stringify({ version }), { mode: 0o600 })
}

/**
 * What is new, or null. A first run has nothing to compare with, so it is only noted. `force` is the
 * reader asking from the menu: the sections of the version that is running.
 */
export function whatsNew(changelog: string, now: string, force = false): Entry[] | null {
  if (force) return entriesOf(changelog).filter((each) => each.version === now)
  if (seen === null) return (markSeen(now), null)
  if (seen === now) return null
  const entries = notesSince(changelog, seen, now)
  return entries.length > 0 ? entries : (markSeen(now), null)
}
