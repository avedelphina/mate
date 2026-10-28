import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { readDocument } from '../shared/comments'
import { isTwinned, twinOf } from '../shared/twin'

/**
 * Where a file stands in the context. The shelf is what is true now. A draft is a proposal.
 * A project file steers a project: its intents and its principles, and nothing else. Material is
 * any other file in a project: what came in for the work, or what was made in it. A context file
 * belongs to the whole context. A pane is what an agent gathered to show the reader.
 * Only a project file steers. Material and panes may hold text from anywhere.
 */
export type Kind = 'shelf' | 'draft' | 'project' | 'material' | 'context' | 'pane'

export type Place = { kind: Kind; project: string | null }

type Entry = Place & {
  /** From the context folder, with forward slashes. */
  path: string
  title: string
  mtime: number
  size: number
  /** The text as the page shows it: comment markers cut out. */
  text: string
  comments: { id: string; text: string }[]
}

export type Index = { version: number; files: Entry[] }

/** One place a search matched. `start` is where, in the text of the file. Null when it is not in the text. */
export type Hit = Place & {
  path: string
  title: string
  before: string
  match: string
  after: string
  start: number | null
  length: number
  /** Set when the match is in a comment and not in the prose. */
  thread: string | null
  /** The whole passage, as the file has it, for a hit found by meaning. */
  passage?: string
}

const VERSION = 4
// ponytail: one JSON file, held in memory, searched from end to end. Good for some thousands of files.
// Past that it wants an inverted index, still rebuilt from the files.
const MAX_BYTES = 2 * 1024 * 1024
const MAX_HITS = 60

export function placeOf(relative: string): Place {
  const parts = relative.split('/')
  if (parts[0] === 'shelf') return { kind: 'shelf', project: null }
  if (parts[0] === 'projects' && parts.length > 2) {
    const [, project, ...rest] = parts
    const steers = rest.length === 1 && (rest[0] === 'intents.md' || rest[0] === 'principles.md')
    const kind = steers ? 'project' : rest.length !== 2 ? 'material' : rest[0] === 'draft' ? 'draft' : rest[0] === 'panes' ? 'pane' : 'material'
    return { kind, project }
  }
  return { kind: 'context', project: null }
}

/** The text in some bytes, when they are text: UTF-8, and no zero byte. A program or a picture is not. */
export function asText(bytes: Buffer): string | null {
  if (bytes.includes(0)) return null
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/**
 * Every file in the context. Hidden folders are skipped, so the index never reads itself. A markdown
 * file is read as a document, one with a text twin by its twin, and any other by its own text when it
 * is text, such as code, an XML config or a log. One that is not text is kept with no text, so it is
 * not read again until it changes.
 */
// ponytail: every text file of the context is held in one JSON index, code included. A large repository
// brought in makes it large; skip build folders by name, or keep the text of files apart, if it grows.
async function walk(contextDir: string, base = ''): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(path.join(contextDir, base), { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const relative = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) found.push(...(await walk(contextDir, relative)))
    else if (entry.isFile()) found.push(relative)
  }
  return found.sort()
}

async function readIndex(file: string): Promise<Index> {
  try {
    const index = JSON.parse(await readFile(file, 'utf8')) as Index
    if (index.version === VERSION && Array.isArray(index.files)) return index
  } catch {
    // Missing or damaged. The files are the source, so it is built again.
  }
  return { version: VERSION, files: [] }
}

async function writeIndex(file: string, index: Index): Promise<void> {
  const dir = path.dirname(file)
  await mkdir(dir, { recursive: true })
  // The index is a helper. It stays out of whatever repository the context is in.
  if (!existsSync(path.join(dir, '.gitignore'))) await writeFile(path.join(dir, '.gitignore'), '*\n')
  const temporary = path.join(dir, `.${path.basename(file)}.${randomUUID()}.tmp`)
  await writeFile(temporary, JSON.stringify(index))
  await rename(temporary, file)
}

const loaded = new Map<string, Index>()

/**
 * The index of one context, brought up to date with its files. Only a file that changed is read again.
 * It is kept in `.indexes/` inside the context and never holds anything from another context.
 */
export async function refreshIndex(contextDir: string): Promise<Index> {
  const file = path.join(contextDir, '.indexes', 'context.json')
  const previous = loaded.get(contextDir) ?? (await readIndex(file))
  const known = new Map(previous.files.map((entry) => [entry.path, entry]))
  const files: Entry[] = []
  let changed = false

  for (const relative of await walk(contextDir)) {
    // A PDF or a Word file is found by its text twin, once there is one. What is read is the twin.
    const twin = isTwinned(relative)
    const read = path.join(contextDir, twin ? twinOf(relative) : relative)
    const info = await stat(read).catch(() => null)
    if (!info || info.size > MAX_BYTES) continue
    const old = known.get(relative)
    if (old && old.mtime === info.mtimeMs && old.size === info.size) {
      files.push(old)
      continue
    }
    changed = true
    const markdown = relative.toLowerCase().endsWith('.md')
    const { text, comments } = twin
      ? { text: await readFile(read, 'utf8'), comments: [] }
      : markdown
        ? readDocument(await readFile(read, 'utf8'))
        : { text: asText(await readFile(read)) ?? '', comments: [] }
    files.push({
      path: relative,
      ...placeOf(relative),
      title: (markdown && /^#{1,6}[ \t]+(.+?)[ \t#]*$/m.exec(text)?.[1]) || path.basename(relative),
      mtime: info.mtimeMs,
      size: info.size,
      text,
      comments: comments.map((comment) => ({
        id: comment.id,
        text: [comment.text, ...comment.replies.map((reply) => reply.text)].filter(Boolean).join('\n')
      }))
    })
  }

  // A project with no draft folder keeps its drafts where they lie: its markdown files are proposals.
  const looseDrafts = new Set(
    [...new Set(files.filter((file) => file.project).map((file) => file.project!))].filter((project) => !existsSync(path.join(contextDir, 'projects', project, 'draft')))
  )
  for (const file of files) {
    if (file.kind !== 'material' || !file.project || !looseDrafts.has(file.project) || !file.path.toLowerCase().endsWith('.md')) continue
    file.kind = 'draft'
  }
  const index = { version: VERSION, files }
  loaded.set(contextDir, index)
  if (changed || files.length !== previous.files.length || !existsSync(file)) {
    // A context that cannot be written to is still searched, from memory.
    await writeIndex(file, index).catch(() => {})
  }
  return index
}

/** Lower case, and accents off, one character for one character, so a place in the folded text is a place in the text. */
function fold(text: string): string {
  return text.toLowerCase().replace(/[À-ɏ]/g, (letter) => letter.normalize('NFD')[0])
}

/** A stretch of text for one line of the result list: no line breaks, and none of the commonest markup. */
const line = (text: string) => text.replace(/\s+/g, ' ').replace(/(^| )#{1,6} /g, '$1').replace(/\*\*|~~|`/g, '')

const RANK: Record<Kind, number> = { shelf: 0, draft: 1, project: 2, material: 3, context: 4, pane: 5 }

/**
 * Files that hold every word of the query, with the places the query occurs as it was typed.
 * Where it does not occur whole, the places of its longest word.
 * The shelf comes first: it is what is true now, and a draft is only a proposal.
 */
export function searchIndex(index: Index, query: string): Hit[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const phrase = words.join(' ')
  const longest = words.reduce((longest, next) => (next.length > longest.length ? next : longest))

  const matching = index.files
    .map((entry) => {
      const title = fold(entry.title)
      const text = fold(entry.text)
      const comments = entry.comments.map((comment) => fold(comment.text))
      const all = [title, text, ...comments].join('\n')
      return { entry, title, text, comments, found: words.every((each) => all.includes(each)) }
    })
    .filter((file) => file.found)
    .sort(
      (a, b) =>
        RANK[a.entry.kind] - RANK[b.entry.kind] ||
        Number(b.title.includes(longest)) - Number(a.title.includes(longest)) ||
        a.entry.path.localeCompare(b.entry.path)
    )

  const hits: Hit[] = []
  for (const { entry, text, comments } of matching) {
    const word = [text, ...comments].some((part) => part.includes(phrase)) ? phrase : longest
    const base = { path: entry.path, kind: entry.kind, project: entry.project, title: entry.title, length: word.length }
    const before = hits.length

    for (let at = text.indexOf(word); at >= 0 && hits.length - before < 3; at = text.indexOf(word, at + word.length)) {
      const from = Math.max(0, at - 40)
      const to = Math.min(entry.text.length, at + word.length + 70)
      hits.push({
        ...base,
        before: (from > 0 ? '…' : '') + line(entry.text.slice(from, at)),
        match: entry.text.slice(at, at + word.length),
        after: line(entry.text.slice(at + word.length, to)) + (to < entry.text.length ? '…' : ''),
        start: at,
        thread: null
      })
    }

    entry.comments.forEach((comment, index) => {
      const at = comments[index].indexOf(word)
      if (at < 0 || hits.length - before >= 3) return
      hits.push({
        ...base,
        before: line(comment.text.slice(Math.max(0, at - 40), at)),
        match: comment.text.slice(at, at + word.length),
        after: line(comment.text.slice(at + word.length, at + word.length + 70)),
        start: null,
        thread: comment.id
      })
    })

    // The words are in the title only. The file is still an answer.
    if (hits.length === before) {
      hits.push({ ...base, before: '', match: '', after: line(entry.text.slice(0, 110)), start: null, thread: null })
    }
    if (hits.length >= MAX_HITS) break
  }
  return hits.slice(0, MAX_HITS)
}
