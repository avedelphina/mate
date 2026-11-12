import { readFileSync, writeFileSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { addReply, fileLineOf, insertComment, parseComments, readDocument } from '../shared/comments'
import { changedParts, diffLines, type DiffLine } from '../shared/diff'
import { editDraft, readProject, resolveInside } from './context'
import type { Seal } from './endpoint'
import { changedIn, commitTexts, fastForward, fetchPull, pushTo, switchTo, undoCommit, versionAt, whereIs } from './git'

/**
 * A pull request on the reader's Gitea, GitHub or GitHub Enterprise, reviewed in Mate. The project is
 * a clone with `origin` on a forge the reader added, with a token of theirs. Mate checks out the pull
 * request, and its conversations on the forge come into the margin. The reader and an agent comment
 * as on any draft. Send posts them as one review of the reader's, and puts the files back as the
 * branch has them. Merge asks the forge to merge. The forge then shows what it would have, had the
 * reader done it there.
 *
 * Nothing connects unless the reader pressed for it, and only to the forge they added (rule 6).
 * Git runs only in a context they trust (rule 7), and Mate never pushes: the forge merges.
 */

export type Kind = 'gitea' | 'github'

type Site = { url: string; kind: Kind; token: string; user?: string }

/** What the window may know of a forge: never its token. */
export type ForgeView = { url: string; kind: Kind; user: string | null }

let file: string | null = null
let seal: Seal | null = null
let sites: Site[] = []
let send: typeof fetch = fetch

/**
 * Where the forges and their sealed tokens are kept. One that is damaged is none. The app gives
 * Electron's fetch, which trusts what the system trusts: a forge with a certificate of the reader's
 * own authority is refused by Node's, which knows only the public ones.
 */
export function keepForgesIn(where: string, sealer: Seal, fetcher: typeof fetch = fetch): void {
  ;[file, seal, send] = [where, sealer, fetcher]
  try {
    const read: unknown = JSON.parse(readFileSync(where, 'utf8'))
    sites = Array.isArray(read) ? read.filter((each) => typeof each?.url === 'string' && typeof each?.token === 'string' && ['gitea', 'github'].includes(each?.kind)) : []
  } catch {
    sites = []
  }
}

export const forgesView = (): ForgeView[] => sites.map((each) => ({ url: each.url, kind: each.kind, user: each.user ?? null }))

const save = () => file && writeFileSync(file, JSON.stringify(sites, null, 2), { mode: 0o600 })

const nameOf = (kind: Kind) => (kind === 'github' ? 'GitHub' : 'Gitea')

/** Where a forge's API is. github.com keeps it on a host of its own. */
const apiOf = (site: { url: string; kind: Kind }) =>
  site.kind === 'gitea' ? `${site.url}/api/v1` : new URL(site.url).hostname === 'github.com' ? 'https://api.github.com' : `${site.url}/api/v3`

/** Gitea says its version to anyone. GitHub Enterprise marks every answer of its API, even a refusal. */
async function kindAt(url: string): Promise<Kind> {
  if (new URL(url).hostname === 'github.com') return 'github'
  let failed: string | null = null
  const ask = (route: string) =>
    send(`${url}${route}`, { redirect: 'error', signal: AbortSignal.timeout(15_000) }).catch((caught: Error) => ((failed = caught.message), null))
  const gitea = await ask('/api/v1/version')
  if (typeof ((await gitea?.json().catch(() => null)) as { version?: unknown } | null)?.version === 'string') return 'gitea'
  if ((await ask('/api/v3/meta'))?.headers.has('x-github-request-id')) return 'github'
  // What the network said, such as a certificate this computer does not trust, is what the reader can act on.
  throw new Error(failed ? `${new URL(url).host} could not be reached: ${failed}` : `Neither Gitea nor GitHub answers at ${new URL(url).host}.`)
}

async function call(site: Site, method: string, route: string, body?: unknown): Promise<unknown> {
  const host = new URL(site.url).host
  const token = seal!.decrypt(Buffer.from(site.token, 'base64'))
  let answer: Response
  try {
    answer = await send(`${apiOf(site)}${route}`, {
      method,
      headers: {
        ...(site.kind === 'github'
          ? { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28' }
          : { accept: 'application/json', authorization: `token ${token}` }),
        ...(body === undefined ? {} : { 'content-type': 'application/json' })
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(30_000)
    })
  } catch {
    throw new Error(`${host} could not be reached.`)
  }
  const text = await answer.text()
  if (!answer.ok) {
    let said = ''
    try {
      // GitHub puts the reason of a refused review in `errors`, after a `message` that says only that it was refused.
      const told = JSON.parse(text) as { message?: unknown; errors?: unknown[] }
      said = [told.message, ...(told.errors ?? []).map((each) => (typeof each === 'string' ? each : (each as { message?: unknown })?.message))].filter(Boolean).join(' ')
    } catch {}
    throw new Error(`${host} answered ${answer.status}${said ? `: ${said}` : '.'}`)
  }
  return text ? JSON.parse(text) : null
}

// ponytail: twenty pages. A pull request with more files or comments shows the first thousand or two.
async function every<T>(site: Site, route: string): Promise<T[]> {
  const size = site.kind === 'github' ? 100 : 50
  const all: T[] = []
  for (let page = 1; page <= 20; page += 1) {
    const got = (await call(site, 'GET', `${route}${route.includes('?') ? '&' : '?'}${site.kind === 'github' ? 'per_page' : 'limit'}=${size}&page=${page}`)) as T[]
    all.push(...got)
    if (got.length < size) break
  }
  return all
}

/**
 * Whose a token is, asked before it is kept: one the forge does not know, or one that cannot write
 * to a repository, is refused. Gitea names a token's scopes when it refuses one; GitHub, for a classic token.
 */
async function check(site: Site): Promise<string | undefined> {
  if (site.kind === 'gitea') {
    await call(site, 'GET', '/repos/search?limit=1').catch((failed: Error) => {
      throw new Error(/ 401/.test(failed.message) ? `${nameOf(site.kind)} does not know that token.` : `That token cannot read repositories. ${failed.message}`)
    })
    try {
      return ((await call(site, 'GET', '/user')) as { login?: string }).login
    } catch (failed) {
      const scopes = /token scope=([\w:,-]+)/.exec((failed as Error).message)?.[1].split(',')
      if (scopes && !scopes.some((each) => each === 'all' || each === 'write:repository')) throw new Error(`That token can only ${scopes.join(', ')}. Mate needs write:repository, to send a review and merge.`)
      return undefined
    }
  }
  const token = seal!.decrypt(Buffer.from(site.token, 'base64'))
  const answer = await send(`${apiOf(site)}/user`, { headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15_000) }).catch(() => null)
  if (!answer) throw new Error(`${new URL(site.url).host} could not be reached.`)
  if (answer.status === 401) throw new Error('GitHub does not know that token.')
  if (!answer.ok) throw new Error(`${new URL(site.url).host} answered ${answer.status}.`)
  // A classic token says its scopes. A fine-grained one does not, and is found out when it is used.
  const scopes = answer.headers.get('x-oauth-scopes')
  if (scopes !== null && !scopes.split(',').some((each) => ['repo', 'public_repo'].includes(each.trim()))) throw new Error(`That token has ${scopes.trim() || 'no scope'}. Mate needs repo, to send a review and merge.`)
  return ((await answer.json()) as { login?: string }).login
}

/** Add a forge, or give one a new token, once the forge has said whose the token is. https, unless it is on this computer. */
export async function addForge(url: string, token: string): Promise<ForgeView[]> {
  let parsed: URL
  try {
    parsed = new URL(String(url).trim())
  } catch {
    throw new Error('That is not an address. It looks like https://git.example.org, or https://github.com.')
  }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) throw new Error('The address must begin with https://, unless it is on this computer.')
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Give the address alone: no name, password or query in it.')
  if (!String(token).trim()) throw new Error('Give a token.')
  const base = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`
  const site: Site = { url: base, kind: await kindAt(base), token: seal!.encrypt(String(token).trim()).toString('base64') }
  const user = await check(site)
  sites = [...sites.filter((each) => new URL(each.url).host !== parsed.host), { ...site, ...(user ? { user } : {}) }]
  save()
  return forgesView()
}

export function removeForge(url: string): ForgeView[] {
  sites = sites.filter((each) => each.url !== url)
  save()
  return forgesView()
}

export type Remote = { host: string; owner: string; repo: string }

/** Where `origin` of a repository is, from its config: an https or ssh address, or ssh's `user@host:path`. */
export function remoteOf(config: string): Remote | null {
  let origin = false
  for (const line of config.split(/\r?\n/)) {
    const head = /^\s*\[(.+)\]\s*$/.exec(line)
    if (head) origin = /^remote\s+"origin"$/.test(head[1].trim())
    const url = origin && !head && /^\s*url\s*=\s*(.+?)\s*$/.exec(line)?.[1]
    if (!url) continue
    let host: string
    let route: string
    const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(url)
    if (scp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) [host, route] = [scp[1], scp[2]]
    else {
      try {
        const parsed = new URL(url)
        ;[host, route] = [parsed.hostname, parsed.pathname]
      } catch {
        return null
      }
    }
    const parts = route.replace(/\.git\/?$/, '').split('/').filter(Boolean)
    return parts.length < 2 ? null : { host: host.toLowerCase(), owner: parts[parts.length - 2], repo: parts[parts.length - 1] }
  }
  return null
}

/** The forge a project's `origin` is on, from those the reader added. */
async function siteOf(projectDir: string): Promise<{ site: Site; remote: Remote }> {
  const config = await readFile(path.join(projectDir, '.git', 'config'), 'utf8').catch(() => null)
  if (config === null) throw new Error('This project is not a git repository of its own. Clone the repository, and bring the clone in as a project.')
  const remote = remoteOf(config)
  if (!remote) throw new Error('This repository has no origin, so it has no pull requests.')
  const site = sites.find((each) => new URL(each.url).hostname.toLowerCase() === remote.host)
  if (!site) throw new Error(`Its origin is on ${remote.host}. Add it in Settings, under Gitea and GitHub, to review its pull requests.`)
  return { site, remote }
}

const repoRoute = (remote: Remote) => `/repos/${encodeURIComponent(remote.owner)}/${encodeURIComponent(remote.repo)}`

type Who = { login?: string }
type Side = { ref: string; sha?: string; repo?: { full_name?: string } | null }
type ForgePull = { number: number; title: string; user?: Who; head: Side; base: Side; merge_base?: string; html_url?: string }
type ForgeReview = { id: number; user?: Who; state: string; body?: string; stale?: boolean; dismissed?: boolean }
type ForgeComment = { id: number; body: string; user?: Who; path: string; position?: number; line?: number | null; side?: string; in_reply_to_id?: number; resolver?: unknown }

/** An open pull request, as the window lists it. */
export type Pull = { number: number; title: string; author: string; head: string; base: string }

/** The pull request a project is checked out on. `back` is where it was before. `base` is the commit it branched from. */
export type Review = { number: number; title: string; url: string; head: string; headRef: string; base: string; baseRef: string; back: string; files: string[] }

/**
 * A review is kept in the repository's own folder, which no agent reads. `imported`: the threads that
 * came from the forge, by file and the id Mate gave them, with the forge's id and how many replies
 * they had. `lines`: on GitHub, the lines of each file a comment may be on, those its diff shows.
 * `fork`: the pull request's branch is on another repository than `origin`.
 */
type Kept = Review & { imported: Record<string, Record<string, { thread: number; replies: number }>>; lines?: Record<string, [number, number][]>; fork?: boolean }

const stateOf = (projectDir: string) => path.join(projectDir, '.git', 'mate-review.json')

function keptIn(projectDir: string): Kept | null {
  try {
    const kept = JSON.parse(readFileSync(stateOf(projectDir), 'utf8')) as Kept
    return Number.isInteger(kept.number) && Array.isArray(kept.files) && typeof kept.head === 'string' ? kept : null
  } catch {
    return null
  }
}

const keep = (projectDir: string, kept: Kept) => writeFile(stateOf(projectDir), JSON.stringify(kept, null, 2))

/** The pull request the project is checked out on, read from the files alone. Nothing connects. */
export function reviewing(contextDir: string, project: string): Review | null {
  const kept = keptIn(resolveInside(contextDir, 'projects', project))
  if (!kept) return null
  const { imported, lines, fork, ...review } = kept
  return review
}

/** How the window opens a file of the project: a draft by its name, any other by its path. */
const pageOf = (view: { drafts: string[]; draftsIn: string }, where: string) => {
  const draft = where.startsWith(view.draftsIn) ? where.slice(view.draftsIn.length) : null
  return draft !== null && view.drafts.includes(draft) ? draft : `/${where}`
}

const fileIn = (projectDir: string, where: string) => resolveInside(projectDir, ...where.split('/'))

/** A comment made in Mate, as the forge has it. One by an agent says whose it is: the forge shows it as the reader's. */
const said = (author: string, text: string) => (author && author !== 'you' ? `**${author}:** ${text}` : text)
const quoted = (text: string) => text.split('\n').map((line) => `> ${line}`).join('\n')

/** `thread`: the forge's id of the conversation a reply is in. `loose`: on a line GitHub takes no comment on. */
type Outgoing = { path: string; line: number; body: string; thread?: number; loose?: boolean }

/**
 * The files of the pull request as the reader has them, beside the branch's. Their text is what the page
 * shows: a draft without its comment markers, any other file as it is, its comments being beside it.
 * A file the pull request does not change cannot go in its review or its commit, so a change to one stops both.
 */
async function pages(contextDir: string, project: string, kept: Kept, env: NodeJS.ProcessEnv) {
  const projectDir = resolveInside(contextDir, 'projects', project)
  const stray = (await changedIn(projectDir, env)).filter((each) => !kept.files.includes(each))
  if (stray.length > 0) throw new Error(`${stray.join(', ')} changed, and pull request #${kept.number} does not change ${stray.length === 1 ? 'it' : 'them'}. Put ${stray.length === 1 ? 'it' : 'them'} back first.`)
  const view = await readProject(contextDir, project)
  const found = []
  for (const where of kept.files) {
    const opened = await readProject(contextDir, project, pageOf(view, where)).catch(() => null)
    const head = opened && (await versionAt(fileIn(projectDir, where), env, kept.head))
    if (opened && head !== null) found.push({ where, opened, head, edited: opened.text !== readDocument(head).text })
  }
  return found
}

/**
 * The comments to send, each on its line of the branch's file. A thread that came from the forge sends
 * only the replies made since. A change to the text goes first, as a commit: the comments are then on its lines.
 */
async function outgoing(contextDir: string, project: string, kept: Kept, env: NodeJS.ProcessEnv): Promise<Outgoing[]> {
  const all = await pages(contextDir, project, kept, env)
  const edited = all.filter((each) => each.edited).map((each) => each.where)
  if (edited.length > 0) throw new Error(`You changed the text of ${edited.join(', ')}. Commit it to the pull request first: your comments then go on the lines of your commit.`)
  const out: Outgoing[] = []
  for (const { where, opened, head } of all) {
    const seen = kept.imported[where] ?? {}
    const lines = head.split('\n')
    for (const thread of opened.comments) {
      const known = Object.hasOwn(seen, thread.id) ? seen[thread.id] : null
      if (thread.resolved && !known) continue
      if (thread.start === null) throw new Error(`A comment on ${where} no longer finds the words it quotes. Anchor it again first.`)
      const line = fileLineOf(head, thread.start)
      const loose = !known && kept.lines !== undefined && !(kept.lines[where] ?? []).some(([from, to]) => line >= from && line <= to)
      const first = (lines[line - 1] ?? '').trim() === thread.anchor ? '' : `${quoted(thread.anchor.slice(0, 300))}\n\n`
      const suggestion = thread.suggestion === undefined ? '' : thread.suggestion === '' ? '\n\nSuggested: remove this.' : `\n\nSuggested instead:\n\n${quoted(thread.suggestion)}`
      if (!known) out.push({ path: where, line, body: first + said(thread.author, thread.text) + suggestion, ...(loose ? { loose } : {}) })
      for (const reply of thread.replies.slice(known?.replies ?? 0)) out.push({ path: where, line, body: said(reply.author, reply.text), ...(known ? { thread: known.thread } : {}), ...(loose ? { loose } : {}) })
    }
  }
  return out
}

/** A conversation on the forge, on one line of one file of the branch. */
type Conversation = { id: number; path: string; line: number; comments: { author: string; body: string }[]; resolved: boolean }

/**
 * The conversations on a pull request. Gitea keeps the comments on one line together; GitHub links a
 * reply to the comment it answers. A comment on a line the branch no longer has, or on the old side, stays on the forge.
 */
async function conversationsOf(site: Site, remote: Remote, number: number): Promise<Conversation[]> {
  const route = `${repoRoute(remote)}/pulls/${number}`
  if (site.kind === 'github') {
    const all = (await every<ForgeComment>(site, `${route}/comments`)).sort((a, b) => a.id - b.id)
    // ponytail: GitHub says whether a conversation was resolved only in GraphQL, so a resolved one comes in too.
    return all
      .filter((each) => !each.in_reply_to_id && (each.line ?? 0) > 0 && each.side !== 'LEFT')
      .map((root) => ({
        id: root.id,
        path: root.path,
        line: root.line!,
        resolved: false,
        comments: [root, ...all.filter((each) => each.in_reply_to_id === root.id)].map((each) => ({ author: each.user?.login ?? '', body: each.body }))
      }))
  }
  const all: ForgeComment[] = []
  for (const review of await every<ForgeReview>(site, `${route}/reviews`)) all.push(...((await call(site, 'GET', `${route}/reviews/${review.id}/comments`)) as ForgeComment[]))
  const threads = new Map<string, ForgeComment[]>()
  for (const each of all.sort((a, b) => a.id - b.id)) {
    if (!((each.position ?? 0) > 0)) continue
    const key = `${each.path}\n${each.position}`
    threads.set(key, [...(threads.get(key) ?? []), each])
  }
  return [...threads.values()].map((thread) => ({
    id: thread[0].id,
    path: thread[0].path,
    line: thread[0].position!,
    resolved: thread.some((each) => each.resolver),
    comments: thread.map((each) => ({ author: each.user?.login ?? '', body: each.body }))
  }))
}

/** The forge's conversations on the files of the pull request, put in the margin. A resolved one stays on the forge. */
async function bringIn(contextDir: string, project: string, kept: Kept, conversations: Conversation[]): Promise<Kept['imported']> {
  const view = await readProject(contextDir, project)
  const imported: Kept['imported'] = {}
  for (const { id: thread, path: where, line, comments, resolved } of conversations) {
    if (resolved || !kept.files.includes(where)) continue
    const [first, ...replies] = comments
    await editDraft(contextDir, project, pageOf(view, where), (markdown) => {
      // ponytail: the forge's line counts comment markers committed in the file; the visible text does not. The quote then lands a few lines off.
      const lines = readDocument(markdown).text.split('\n')
      let at = Math.min(line, lines.length) - 1
      while (at > 0 && !lines[at].trim()) at -= 1
      const from = lines.slice(0, at).join('\n').length + (at > 0 ? 1 : 0)
      let next = insertComment(markdown, lines[at], first.body, first.author, from)
      const id = parseComments(next).at(-1)!.id
      for (const reply of replies) next = addReply(next, id, reply.body, reply.author)
      imported[where] = { ...imported[where], [id]: { thread, replies: replies.length } }
      return next
    }).catch(() => {})
  }
  return imported
}

/** The files of the pull request as its branch has them. What the review left in them goes. */
async function putBack(contextDir: string, project: string, kept: Kept, env: NodeJS.ProcessEnv): Promise<void> {
  const projectDir = resolveInside(contextDir, 'projects', project)
  const view = await readProject(contextDir, project)
  for (const where of kept.files) {
    const full = fileIn(projectDir, where)
    const head = await versionAt(full, env, kept.head)
    if (head === null) continue
    const page = pageOf(view, where)
    // The review's comments are in the context. Writing the branch's text over the page takes them with it.
    await editDraft(contextDir, project, page, () => head).catch(() => {})
  }
}

const VERDICTS: Record<string, string> = { CHANGES_REQUESTED: 'REQUEST_CHANGES', COMMENTED: 'COMMENT' }

/**
 * The open pull requests of the project's repository, and what was said of the one under review.
 * What is waiting to be sent is counted with git, so only in a context the reader trusts.
 */
export async function listPulls(contextDir: string, project: string, env: NodeJS.ProcessEnv, trusted: boolean) {
  const projectDir = resolveInside(contextDir, 'projects', project)
  const { site, remote } = await siteOf(projectDir)
  const open = await every<ForgePull>(site, `${repoRoute(remote)}/pulls?state=open`)
  const kept = keptIn(projectDir)
  const reviews = kept ? await every<ForgeReview>(site, `${repoRoute(remote)}/pulls/${kept.number}/reviews`) : []
  let pending: number | string = 0
  let edited: string[] = []
  if (kept && !trusted) pending = 'Trust this context to send your review.'
  else if (kept) {
    edited = await pages(contextDir, project, kept, env).then((all) => all.filter((each) => each.edited).map((each) => each.where), () => [])
    pending = await outgoing(contextDir, project, kept, env).then((each) => each.length, (failed: Error) => failed.message)
  }
  return {
    forge: nameOf(site.kind),
    host: new URL(site.url).host,
    repo: `${remote.owner}/${remote.repo}`,
    pulls: open.map((each): Pull => ({ number: each.number, title: each.title, author: each.user?.login ?? '', head: each.head.ref, base: each.base.ref })),
    review: reviewing(contextDir, project),
    verdicts: reviews
      .map((each) => ({ ...each, state: VERDICTS[each.state] ?? each.state }))
      .filter((each) => !each.dismissed && !['PENDING', 'DISMISSED'].includes(each.state))
      .map((each) => ({ author: each.user?.login ?? '', state: each.state, body: each.body ?? '', stale: Boolean(each.stale) })),
    /** How many comments are to be sent, or why none can be. */
    pending,
    /** The files whose text the reader changed, to be committed to the pull request. */
    edited,
    /** The branch of the pull request is on a fork, where Mate does not push. */
    fork: Boolean(kept?.fork)
  }
}

/** The lines of each file GitHub takes a comment on: those its diff shows, on the branch's side. */
const shownLines = (patch?: string): [number, number][] =>
  [...(patch ?? '').matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)].map((hunk) => [Number(hunk[1]), Number(hunk[1]) + Number(hunk[2] ?? 1) - 1])

/** Check out a pull request in the project, and put the forge's conversations on it in the margin. */
export async function takePull(contextDir: string, project: string, number: number, env: NodeJS.ProcessEnv): Promise<Review> {
  const projectDir = resolveInside(contextDir, 'projects', project)
  const { site, remote } = await siteOf(projectDir)
  const now = keptIn(projectDir)
  if (now) throw new Error(`This project is on pull request #${now.number}. Send that review, or leave it, first.`)
  const changed = await changedIn(projectDir, env)
  if (changed.length > 0) throw new Error(`${changed.slice(0, 3).join(', ')}${changed.length > 3 ? ' and more' : ''} changed since the last commit. Commit or put back what changed before you review a pull request.`)
  const route = `${repoRoute(remote)}/pulls/${number}`
  const pull = (await call(site, 'GET', route)) as ForgePull
  // GitHub does not say where a pull request branched from. Its comparison of the two branches does.
  const base =
    site.kind === 'github'
      ? ((await call(site, 'GET', `${repoRoute(remote)}/compare/${pull.base.sha}...${pull.head.sha}`)) as { merge_base_commit?: { sha?: string } }).merge_base_commit?.sha
      : pull.merge_base
  const changes = (await every<{ filename: string; status: string; patch?: string }>(site, `${route}/files`)).filter((each) => !['deleted', 'removed'].includes(each.status))
  const back = await whereIs(projectDir, env)
  const head = await fetchPull(projectDir, env, number)
  await switchTo(projectDir, env, head)
  const kept: Kept = {
    number,
    title: pull.title,
    url: pull.html_url ?? '',
    head,
    headRef: pull.head.ref,
    base: base ?? '',
    baseRef: pull.base.ref,
    back,
    files: changes.map((each) => each.filename),
    imported: {},
    fork: Boolean(pull.head.repo?.full_name && pull.base.repo?.full_name && pull.head.repo.full_name !== pull.base.repo.full_name) || pull.head.repo === null,
    ...(site.kind === 'github' ? { lines: Object.fromEntries(changes.map((each) => [each.filename, shownLines(each.patch)])) } : {})
  }
  // Kept first: what comes in after can always be left again.
  await keep(projectDir, kept)
  kept.imported = await bringIn(contextDir, project, kept, await conversationsOf(site, remote, number))
  await keep(projectDir, kept)
  return reviewing(contextDir, project)!
}

/** What the pull request changed in one of its files: the commit it branched from, against its last. */
export async function pullChanges(contextDir: string, project: string, where: string, env: NodeJS.ProcessEnv): Promise<DiffLine[]> {
  const projectDir = resolveInside(contextDir, 'projects', project)
  const kept = keptIn(projectDir)
  if (!kept?.files.includes(where)) throw new Error('That file is not in the pull request under review.')
  const full = fileIn(projectDir, where)
  const before = kept.base ? await versionAt(full, env, kept.base) : null
  return diffLines(before ?? '', (await versionAt(full, env, kept.head)) ?? '')
}

/** What a commit would take, for the dialog that asks the reader: which files, to which branch, on which forge. Nothing connects. */
export async function commitToSend(contextDir: string, project: string, env: NodeJS.ProcessEnv) {
  const projectDir = resolveInside(contextDir, 'projects', project)
  const kept = keptIn(projectDir)
  if (!kept) throw new Error('This project is on no pull request.')
  if (kept.fork) throw new Error(`The branch of pull request #${kept.number} is on a fork. Mate pushes only to origin: commit there with git, or ask its author.`)
  const { site } = await siteOf(projectDir)
  const files = (await pages(contextDir, project, kept, env)).filter((each) => each.edited).map((each) => each.where)
  if (files.length === 0) throw new Error('You changed no text of the pull request.')
  return { host: new URL(site.url).host, number: kept.number, branch: kept.headRef, files }
}

/** The reader's change to the text, as lines taken out and put in, for the on-device model to word a commit by. */
export async function changeToCommit(contextDir: string, project: string, env: NodeJS.ProcessEnv): Promise<string> {
  const kept = keptIn(resolveInside(contextDir, 'projects', project))
  if (!kept) throw new Error('This project is on no pull request.')
  const edited = (await pages(contextDir, project, kept, env)).filter((each) => each.edited)
  if (edited.length === 0) throw new Error('You changed no text of the pull request.')
  // ponytail: cut at 6,000 characters, which the on-device model takes with room to answer. A larger change is worded by its start.
  return edited
    .map(({ where, opened, head }) => [`In ${where}:`, ...changedParts(diffLines(readDocument(head).text, opened.text), 1).map((line) => `${line.kind} ${line.text}`)].join('\n'))
    .join('\n\n')
    .slice(0, 6000)
}

/**
 * Commit the text the reader changed to the pull request, and push it to its branch on `origin`. The
 * commit is the reader's, in their words and under their git name. It takes the text the page shows,
 * so a comment of the review is not in it. A branch that has moved on refuses it: there is no force.
 */
export async function commitToPull(contextDir: string, project: string, message: string, env: NodeJS.ProcessEnv): Promise<{ files: string[]; branch: string }> {
  const projectDir = resolveInside(contextDir, 'projects', project)
  const kept = keptIn(projectDir)
  if (!kept) throw new Error('This project is on no pull request.')
  if (kept.fork) throw new Error(`The branch of pull request #${kept.number} is on a fork. Mate pushes only to origin.`)
  const { site, remote } = await siteOf(projectDir)
  const edited = (await pages(contextDir, project, kept, env)).filter((each) => each.edited)
  if (edited.length === 0) throw new Error('You changed no text of the pull request.')
  // ponytail: a draft is committed as the page shows it, so comment markers committed in it before are left out. Keep them when a repository holds them.
  const head = await commitTexts(projectDir, env, edited.map((each) => ({ path: each.where, text: each.opened.text })), message)
  try {
    await pushTo(projectDir, env, kept.headRef)
  } catch (failed) {
    // Not pushed, the commit is taken off again: the review goes on from the branch as it was, the text as the reader left it.
    await undoCommit(projectDir, env, kept.head).catch(() => {})
    throw failed
  }
  kept.head = head
  // GitHub takes a comment only on the lines its diff shows, and the diff is a new one now.
  if (site.kind === 'github') {
    const changes = await every<{ filename: string; patch?: string }>(site, `${repoRoute(remote)}/pulls/${kept.number}/files`).catch(() => null)
    if (changes) kept.lines = Object.fromEntries(changes.map((each) => [each.filename, shownLines(each.patch)]))
  }
  await keep(projectDir, kept)
  return { files: edited.map((each) => each.where), branch: kept.headRef }
}

export type Verdict = 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVED'

/** What Send would post: to which forge, on which pull request, and how many comments. Nothing connects. */
export async function reviewToSend(contextDir: string, project: string, env: NodeJS.ProcessEnv) {
  const projectDir = resolveInside(contextDir, 'projects', project)
  const kept = keptIn(projectDir)
  if (!kept) throw new Error('This project is on no pull request.')
  const { site } = await siteOf(projectDir)
  return { forge: nameOf(site.kind), host: new URL(site.url).host, number: kept.number, title: kept.title, comments: (await outgoing(contextDir, project, kept, env)).length }
}

/**
 * Post the reader's review, then show the pull request as the forge has it now. Gitea takes every
 * comment in the review, a reply on its line. GitHub takes a reply in its conversation, and a comment
 * only on a line its diff shows: one elsewhere goes in the review's words, with its file and line.
 */
export async function sendReview(contextDir: string, project: string, verdict: Verdict, body: string, env: NodeJS.ProcessEnv): Promise<number> {
  if (!['COMMENT', 'REQUEST_CHANGES', 'APPROVED'].includes(verdict)) throw new Error('A review comments, asks for changes, or approves.')
  const projectDir = resolveInside(contextDir, 'projects', project)
  const kept = keptIn(projectDir)
  if (!kept) throw new Error('This project is on no pull request.')
  const { site, remote } = await siteOf(projectDir)
  const route = `${repoRoute(remote)}/pulls/${kept.number}`
  const comments = await outgoing(contextDir, project, kept, env)
  if (verdict === 'COMMENT' && comments.length === 0 && !body.trim()) throw new Error('There is nothing to send: no comment, and no words for the review.')
  if (site.kind === 'gitea') {
    await call(site, 'POST', `${route}/reviews`, { event: verdict, body: String(body), commit_id: kept.head, comments: comments.map((each) => ({ path: each.path, body: each.body, new_position: each.line })) })
  } else {
    for (const reply of comments.filter((each) => each.thread !== undefined)) await call(site, 'POST', `${route}/comments/${reply.thread}/replies`, { body: reply.body })
    const loose = comments.filter((each) => each.thread === undefined && each.loose).map((each) => `**${each.path}, line ${each.line}**\n\n${each.body}`)
    const words = [String(body).trim(), ...loose].filter(Boolean).join('\n\n---\n\n')
    const placed = comments.filter((each) => each.thread === undefined && !each.loose).map((each) => ({ path: each.path, line: each.line, side: 'RIGHT', body: each.body }))
    // Replies alone are sent already: a review with nothing in it would be refused.
    if (verdict !== 'COMMENT' || words || placed.length > 0) {
      await call(site, 'POST', `${route}/reviews`, { commit_id: kept.head, event: verdict === 'APPROVED' ? 'APPROVE' : verdict, ...(words ? { body: words } : {}), comments: placed })
    }
  }
  await putBack(contextDir, project, kept, env)
  kept.imported = await bringIn(contextDir, project, kept, await conversationsOf(site, remote, kept.number)).catch(() => ({}))
  await keep(projectDir, kept)
  return comments.length
}

/** Go back to where the project was. Comments not sent stop it: they would be lost. */
export async function leavePull(contextDir: string, project: string, env: NodeJS.ProcessEnv): Promise<Review> {
  const projectDir = resolveInside(contextDir, 'projects', project)
  const kept = keptIn(projectDir)
  if (!kept) throw new Error('This project is on no pull request.')
  const left = (await outgoing(contextDir, project, kept, env)).length
  if (left > 0) throw new Error(`${left === 1 ? 'One comment is' : `${left} comments are`} not sent yet. Send the review first.`)
  await putBack(contextDir, project, kept, env)
  await switchTo(projectDir, env, kept.back)
  await rm(stateOf(projectDir), { force: true })
  return kept
}

/** How the forge merges this repository's pull requests: Gitea's setting, or the first way GitHub allows. */
export async function mergeStyle(contextDir: string, project: string): Promise<{ forge: string; host: string; style: string }> {
  const { site, remote } = await siteOf(resolveInside(contextDir, 'projects', project))
  const repo = (await call(site, 'GET', repoRoute(remote))) as { default_merge_style?: string; allow_merge_commit?: boolean; allow_squash_merge?: boolean; allow_rebase_merge?: boolean }
  const style =
    site.kind === 'gitea'
      ? repo.default_merge_style || 'merge'
      : // Only someone who may push is told what is allowed. Anyone else asks for a merge commit, and GitHub says if it is not.
        repo.allow_merge_commit !== false ? 'merge' : repo.allow_squash_merge !== false ? 'squash' : 'rebase'
  return { forge: nameOf(site.kind), host: new URL(site.url).host, style }
}

/**
 * The forge merges the pull request, and the project goes back to where it was. A branch it was on
 * that the merge went into is brought up to the forge's. Mate pushes nothing: the merge is the forge's.
 */
export async function mergePull(contextDir: string, project: string, style: string, env: NodeJS.ProcessEnv): Promise<{ number: number; base: string; moved: boolean }> {
  const projectDir = resolveInside(contextDir, 'projects', project)
  const kept = keptIn(projectDir)
  if (!kept) throw new Error('This project is on no pull request.')
  const { site, remote } = await siteOf(projectDir)
  const left = (await outgoing(contextDir, project, kept, env)).length
  if (left > 0) throw new Error(`${left === 1 ? 'One comment is' : `${left} comments are`} not sent yet. Send the review first.`)
  const route = `${repoRoute(remote)}/pulls/${kept.number}/merge`
  if (site.kind === 'gitea') await call(site, 'POST', route, { Do: style })
  else await call(site, 'PUT', route, { merge_method: style, sha: kept.head })
  await leavePull(contextDir, project, env)
  const moved = kept.back === kept.baseRef && (await fastForward(projectDir, env, kept.baseRef).catch(() => false))
  return { number: kept.number, base: kept.baseRef, moved }
}
