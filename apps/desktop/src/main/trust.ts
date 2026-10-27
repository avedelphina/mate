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
    },
    clear(): void {
      listed.clear()
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

// The private contexts that the reader's own endpoint may read, through Hermes in the sandbox. See endpoint.ts.
const opened = listOf()
export const keepOpenedIn = opened.keepIn
export const isOpenedToEndpoint = opened.has
export const moveOpened = opened.move
export const setOpenedToEndpoint = opened.set
/** The endpoint's host changed: no context is open to the new one until the reader says so, by name. */
export const closeAllToEndpoint = opened.clear

/** What an agent, or the reader trying to invite one, is told in a private context. */
export const PRIVATE = 'This context is private. Nothing of it leaves this computer, so no agent works in it.'
export const PRIVATE_BUT_ENDPOINT = 'This context is private. Only Hermes on your own endpoint works in it.'

/** Whether this agent may work in this context, as far as privacy goes. Only a private context limits it. */
export function privacyAllows(contextDir: string, agent: string, host: string | null): boolean {
  if (!isPrivate(contextDir)) return true
  return agent === 'private' && host === null && isOpenedToEndpoint(contextDir)
}

export const privacyRefusal = (contextDir: string): string => (isOpenedToEndpoint(contextDir) ? PRIVATE_BUT_ENDPOINT : PRIVATE)
