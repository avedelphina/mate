import { readFileSync, writeFileSync } from 'node:fs'
import type { Seal } from './endpoint'

/**
 * A web page becomes markdown through the reader's own Firecrawl: its cloud, or one they run. Only the
 * address of the page goes out, and only when the reader presses for it. The key is kept sealed like
 * the endpoint's, and no agent is given it.
 */

type Stored = { key?: string; base?: string }

/** What the window may know: never the key. */
export type FirecrawlView = { hasKey: boolean; base: string }

export const CLOUD = 'https://api.firecrawl.dev'

let file: string | null = null
let seal: Seal | null = null
let stored: Stored = {}

/** Where the key is kept, in the app's data folder. A file that is missing or damaged is no key. */
export function keepFirecrawlIn(where: string, sealer: Seal): void {
  ;[file, seal] = [where, sealer]
  try {
    const read = JSON.parse(readFileSync(where, 'utf8')) as Stored
    stored = { ...(typeof read.key === 'string' ? { key: read.key } : {}), ...(typeof read.base === 'string' ? { base: read.base } : {}) }
  } catch {
    stored = {}
  }
}

export const firecrawlView = (): FirecrawlView => ({ hasKey: Boolean(stored.key), base: stored.base ?? CLOUD })

/** Like the endpoint: https, or on this computer. A key does not cross a network in clear text. */
export function checkBase(base: string): string {
  let parsed: URL
  try {
    parsed = new URL(String(base).trim())
  } catch {
    throw new Error(`That is not an address. Firecrawl's own is ${CLOUD}.`)
  }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) throw new Error('The address must begin with https://, unless it is on this computer.')
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error('Give the address alone, such as https://firecrawl.example.com.')
  return parsed.origin
}

/**
 * Ask what the key is good for, which costs nothing: the credits left. A refusal is the one answer that
 * means the key is wrong. Any other trouble, such as a server that does not have this call, is not.
 */
async function probe(base: string, key: string): Promise<{ refused: true } | { refused: false; said: string }> {
  try {
    const response = await fetch(`${base}/v2/team/credit-usage`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) })
    if (response.status === 401 || response.status === 403) return { refused: true }
    const body = (await response.json().catch(() => null)) as { data?: { remainingCredits?: unknown } } | null
    const left = body?.data?.remainingCredits
    if (response.ok && typeof left === 'number') return { refused: false, said: `The key works. ${left} credits left.` }
    return { refused: false, said: `Saved, but Firecrawl did not say what the key can do (${response.status}).` }
  } catch {
    return { refused: false, said: 'Saved, but Firecrawl could not be reached to check the key.' }
  }
}

/**
 * Save the settings, and try the key first: one that Firecrawl refuses is not saved. A key left empty keeps
 * the one saved before, unless the address changed. An empty address is the cloud. Gives what the try found.
 */
export async function setFirecrawl(key: string | undefined, base: string): Promise<string> {
  const next: Stored = {}
  const address = String(base).trim() === '' ? CLOUD : checkBase(base)
  if (address !== CLOUD) next.base = address
  if (key) next.key = seal!.encrypt(key).toString('base64')
  else if (stored.key && (stored.base ?? CLOUD) === address) next.key = stored.key
  const using = key ?? (next.key ? seal!.decrypt(Buffer.from(next.key, 'base64')) : null)
  let said = 'Saved. There is no key to try.'
  if (using) {
    const tried = await probe(address, using)
    if (tried.refused) throw new Error('Firecrawl did not accept that key. Nothing was changed.')
    said = tried.said
  }
  stored = next
  if (file) writeFileSync(file, JSON.stringify(stored, null, 2), { mode: 0o600 })
  return said
}

/** The cloud cannot reach this computer or a private network, so say so now instead of after the wait. */
export function checkLink(link: string): URL {
  let parsed: URL
  try {
    parsed = new URL(String(link).trim())
  } catch {
    throw new Error('That is not an address. It looks like https://example.com/page.')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('The address must begin with https:// or http://.')
  if (parsed.username || parsed.password) throw new Error('Give the address without a name or password in it.')
  const host = parsed.hostname
  if (!host.includes('.') || host.endsWith('.local') || /^(127|10|0)\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^169\.254\./.test(host) || host.startsWith('[')) {
    if (stored.base === undefined) throw new Error('Firecrawl in the cloud cannot reach a page on this computer or a private network.')
  }
  return parsed
}

/** The page as markdown, with its title. */
export async function scrapePage(link: string): Promise<{ title: string; markdown: string }> {
  const url = checkLink(link)
  if (!stored.key && stored.base === undefined) throw new Error('Add your Firecrawl key in Settings first.')
  const key = stored.key ? seal!.decrypt(Buffer.from(stored.key, 'base64')) : null
  let response: Response
  try {
    response = await fetch(`${stored.base ?? CLOUD}/v2/scrape`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ url: url.href, formats: ['markdown'], onlyMainContent: true }),
      signal: AbortSignal.timeout(90_000)
    })
  } catch {
    throw new Error('Could not reach Firecrawl.')
  }
  const body = (await response.json().catch(() => null)) as { success?: boolean; error?: unknown; data?: { markdown?: unknown; metadata?: { title?: unknown } } } | null
  if (!response.ok || !body?.success) throw new Error(`Firecrawl said no${typeof body?.error === 'string' ? `: ${body.error.slice(0, 200)}` : ` (${response.status})`}.`)
  const markdown = typeof body.data?.markdown === 'string' ? body.data.markdown : ''
  if (!markdown.trim()) throw new Error('Firecrawl found no text on that page.')
  const title = body.data?.metadata?.title
  return { title: (Array.isArray(title) ? String(title[0] ?? '') : typeof title === 'string' ? title : '').trim() || url.hostname, markdown }
}
