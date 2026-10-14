import { readFileSync, realpathSync, writeFileSync } from 'node:fs'

/**
 * The contexts the reader trusts. In a trusted context an invited agent runs as it does in the
 * reader's own terminal. Everywhere else it gets tools for files and nothing more.
 *
 * The list is kept outside every context, so no context can add itself to it.
 */
let file: string | null = null
let trusted = new Set<string>()

/** A context is known by its real path. A folder that was moved, or another one under a link, is not it. */
function real(contextDir: string): string {
  try {
    return realpathSync(contextDir)
  } catch {
    return contextDir
  }
}

/** Where the list is kept. A list that is missing or damaged trusts nothing. */
export function keepTrustIn(path: string): void {
  file = path
  try {
    const listed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    trusted = new Set(Array.isArray(listed) ? listed.filter((each) => typeof each === 'string') : [])
  } catch {
    trusted = new Set()
  }
}

export const isTrusted = (contextDir: string): boolean => trusted.has(real(contextDir))

/**
 * A trusted context was renamed: its trust goes with it. `was` is the real path it had. The old
 * path is trusted no more, so that another folder made there later is not trusted by mistake.
 */
export function moveTrust(was: string, now: string): void {
  if (!trusted.delete(was)) return
  trusted.add(real(now))
  if (file) writeFileSync(file, JSON.stringify([...trusted], null, 2), { mode: 0o600 })
}

export function setTrusted(contextDir: string, yes: boolean): void {
  if (yes) trusted.add(real(contextDir))
  else trusted.delete(real(contextDir))
  if (file) writeFileSync(file, JSON.stringify([...trusted], null, 2), { mode: 0o600 })
}
