import { readFileSync, realpathSync, writeFileSync } from 'node:fs'

/**
 * The contexts the reader trusts, and the ones the reader keeps private. In a trusted context an
 * invited agent runs as it does in the reader's own terminal. Everywhere else it gets tools for
 * files and nothing more. In a private context no agent works at all, so nothing of it leaves the
 * computer.
 *
 * Each list is kept outside every context, so no context, and no agent in it, can change it.
 */

/** A context is known by its real path. A folder that was moved, or another one under a link, is not it. */
function real(contextDir: string): string {
  try {
    return realpathSync(contextDir)
  } catch {
    return contextDir
  }
}

/** A list of contexts, kept in a file of Mate's own. Until it is given one, it is kept in memory only. */
function listOf() {
  let file: string | null = null
  let listed = new Set<string>()
  const save = () => {
    if (file) writeFileSync(file, JSON.stringify([...listed], null, 2), { mode: 0o600 })
  }
  return {
    /** Where the list is kept. A list that is missing or damaged holds nothing. */
    keepIn(path: string): void {
      file = path
      try {
        const kept: unknown = JSON.parse(readFileSync(path, 'utf8'))
        listed = new Set(Array.isArray(kept) ? kept.filter((each) => typeof each === 'string') : [])
      } catch {
        listed = new Set()
      }
    },
    has: (contextDir: string): boolean => listed.has(real(contextDir)),
    /**
     * A listed context was renamed: it stays listed under its new name. `was` is the real path it
     * had. The old path is listed no more, so that another folder made there later is not listed by mistake.
     */
    move(was: string, now: string): void {
      if (!listed.delete(was)) return
      listed.add(real(now))
      save()
    },
    set(contextDir: string, yes: boolean): void {
      if (yes) listed.add(real(contextDir))
      else listed.delete(real(contextDir))
      save()
    }
  }
}

const trusted = listOf()
export const keepTrustIn = trusted.keepIn
export const isTrusted = trusted.has
export const moveTrust = trusted.move
export const setTrusted = trusted.set

const kept = listOf()
export const keepPrivacyIn = kept.keepIn
export const isPrivate = kept.has
export const movePrivacy = kept.move
export const setPrivate = kept.set

/** What an agent, or the reader trying to invite one, is told in a private context. */
export const PRIVATE = 'This context is private. Nothing of it leaves this computer, so no agent works in it.'
