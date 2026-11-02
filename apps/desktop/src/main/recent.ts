import { readFileSync, statSync, writeFileSync } from 'node:fs'

/**
 * The contexts opened last, newest first, for the window that has none open. Kept in a file of
 * Mate's own, outside every context, like the list of trusted ones. Until it is given a file it is
 * kept in memory only.
 */
let file: string | null = null
let recent: string[] = []
const LONGEST = 10

const save = () => {
  if (file) writeFileSync(file, JSON.stringify(recent, null, 2), { mode: 0o600 })
}

/** Where the list is kept. A list that is missing or damaged holds nothing. */
export function keepRecentIn(where: string): void {
  file = where
  try {
    const kept: unknown = JSON.parse(readFileSync(where, 'utf8'))
    recent = Array.isArray(kept) ? kept.filter((each): each is string => typeof each === 'string').slice(0, LONGEST) : []
  } catch {
    recent = []
  }
}

/** A context was opened in a window: it goes to the top. */
export function rememberContext(contextDir: string): void {
  recent = [contextDir, ...recent.filter((each) => each !== contextDir)].slice(0, LONGEST)
  save()
}

/** A context was renamed. It keeps its place under its new name. */
export function moveRecent(was: string, now: string): void {
  recent = recent.map((each) => (each === was ? now : each))
  save()
}

/** The contexts opened last that are still folders on this computer. */
export const recentContexts = (): string[] =>
  recent.filter((each) => {
    try {
      return statSync(each).isDirectory()
    } catch {
      return false
    }
  })
