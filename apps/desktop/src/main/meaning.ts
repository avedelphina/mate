import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Hit, Index } from './contextIndex'

/**
 * Search by meaning: each document of a context, its PDF and Word files by their text twins, is
 * cut into passages, and each passage gets a vector from an embedding model. A question gets one
 * too, and the passages closest to it are found, in whatever words or language they are written.
 *
 * The model is bge-m3, run by Ollama on this computer: it is the one that found the right passage
 * across English, Czech and Slovak. Nothing leaves the computer. Without Ollama and that model,
 * there is no search by meaning, and nothing else changes.
 *
 * The vectors are a helper like the index, kept in `.indexes/meaning.json`, made again from the
 * files and safe to delete.
 */

/** Gives one vector for each text, in order. Ollama in the app, a stand-in in the tests. */
export type Embed = (texts: string[]) => Promise<number[][]>

export const OLLAMA = 'http://127.0.0.1:11434'
export const MODEL = 'bge-m3'

const VERSION = 1
// About a page of a book: long enough to hold a thought, short enough to say where it is.
const PASSAGE = 1000
const BATCH = 16
const SHOWN = 8
// ponytail: one bar for what counts as close, read off a small test in English, Czech and Slovak:
// the right passage scored 0.50 to 0.62, everything else 0.42 or less. Tune it on real contexts.
const CLOSE = 0.45

type Passage = { start: number; end: number }
type Stored = {
  version: number
  model: string
  // Each vector is kept as bytes, one for each dimension: a quarter of the space, and the order of the passages it finds is the same.
  files: Record<string, { mtime: number; size: number; passages: (Passage & { v: string })[] }>
}

/** The passages of a text: paragraphs together up to about a thousand characters. A longer one is cut after a sentence. */
export function passages(text: string): Passage[] {
  const found: Passage[] = []
  const paragraphs = [...text.matchAll(/[^\n]+(?:\n(?!\s*\n)[^\n]*)*/g)].map((each) => ({ start: each.index, end: each.index + each[0].trimEnd().length }))
  let open: Passage | null = null
  const close = () => {
    if (open && text.slice(open.start, open.end).trim()) found.push(open)
    open = null
  }
  for (const each of paragraphs) {
    if (open && each.end - open.start > PASSAGE) close()
    if (!open) open = { ...each }
    else open.end = each.end
    // One paragraph longer than a passage is cut at the last sentence that fits, or where it must be.
    while (open.end - open.start > PASSAGE * 1.5) {
      const room: string = text.slice(open.start, open.start + PASSAGE)
      const stop: number = Math.max(room.lastIndexOf('. '), room.lastIndexOf('.\n'), room.lastIndexOf('? '), room.lastIndexOf('! '))
      const cut: number = open.start + (stop > PASSAGE / 2 ? stop + 1 : PASSAGE)
      found.push({ start: open.start, end: cut })
      open = { start: cut, end: open.end }
    }
  }
  close()
  return found
}

const unit = (vector: number[]) => {
  const length = Math.hypot(...vector) || 1
  return vector.map((each) => each / length)
}
const pack = (vector: number[]) => Buffer.from(Int8Array.from(unit(vector), (each) => Math.round(each * 127)).buffer).toString('base64')
const unpack = (packed: string) => {
  const bytes = Buffer.from(packed, 'base64')
  return new Int8Array(bytes.buffer, bytes.byteOffset, bytes.length)
}

const stores = new Map<string, Stored>()
const where = (contextDir: string) => path.join(contextDir, '.indexes', 'meaning.json')

async function load(contextDir: string): Promise<Stored> {
  const known = stores.get(contextDir)
  if (known) return known
  let stored: Stored = { version: VERSION, model: MODEL, files: {} }
  try {
    const read = JSON.parse(await readFile(where(contextDir), 'utf8')) as Stored
    // Vectors of another model, or of another shape, mean nothing to this one. They are made again.
    if (read.version === VERSION && read.model === MODEL && read.files) stored = read
  } catch {
    // Missing or damaged. The files are the source, so it is made again.
  }
  stores.set(contextDir, stored)
  return stored
}

async function save(contextDir: string, stored: Stored): Promise<void> {
  const file = where(contextDir)
  await mkdir(path.dirname(file), { recursive: true })
  if (!existsSync(path.join(path.dirname(file), '.gitignore'))) await writeFile(path.join(path.dirname(file), '.gitignore'), '*\n')
  await writeFile(`${file}.tmp`, JSON.stringify(stored))
  await rename(`${file}.tmp`, file)
}

/** A folder of the context was renamed. Its passages keep their vectors under the new path, so none is learned again. */
export async function moveMeaning(contextDir: string, from: string, to: string): Promise<void> {
  const stored = await load(contextDir)
  let moved = false
  for (const name of Object.keys(stored.files)) {
    if (!name.startsWith(from)) continue
    stored.files[to + name.slice(from.length)] = stored.files[name]
    delete stored.files[name]
    moved = true
  }
  if (moved) await save(contextDir, stored)
}

/** A context was renamed: what was held of it under its old folder is let go. Its file went with it. */
export const forgetMeaning = (contextDir: string): void => void stores.delete(contextDir)

/**
 * Bring the vectors of a context up to date with its index: the passages of a file that changed
 * are found again and given vectors, and a file that is gone takes its own with it. `left` hears
 * how many files are still to do. Gives the number of files done or taken away.
 */
export async function refreshMeaning(contextDir: string, index: Index, embed: Embed, left: (count: number) => void = () => {}): Promise<number> {
  const stored = await load(contextDir)
  const wanted = new Map(index.files.map((file) => [file.path, file]))
  let changed = 0
  for (const known of Object.keys(stored.files)) {
    if (wanted.has(known)) continue
    delete stored.files[known]
    changed++
  }
  const due = index.files.filter((file) => stored.files[file.path]?.mtime !== file.mtime || stored.files[file.path]?.size !== file.size)
  for (const [done, file] of due.entries()) {
    left(due.length - done)
    const found = passages(file.text)
    const vectors: number[][] = []
    // The title goes with each passage: it says what the passage is part of.
    for (let at = 0; at < found.length; at += BATCH) {
      vectors.push(...(await embed(found.slice(at, at + BATCH).map((each) => `${file.title}\n${file.text.slice(each.start, each.end)}`))))
    }
    stored.files[file.path] = { mtime: file.mtime, size: file.size, passages: found.map((each, i) => ({ ...each, v: pack(vectors[i]) })) }
    changed++
    // What is done is kept as it goes, so that a closed app does not lose it all.
    if (done % 25 === 24) await save(contextDir, stored)
  }
  left(0)
  if (changed > 0) await save(contextDir, stored)
  return changed
}

/**
 * The passages closest in meaning to a question, the closest first, as search hits: a hit opens
 * its file at the passage. Only what is close enough is given: a question nothing answers finds
 * nothing. What has not been given vectors yet is not found yet.
 */
// ponytail: every passage is compared with the question, one after the other. Fine for some ten
// thousand passages. Past that it wants an index of the vectors themselves.
export async function searchMeaning(contextDir: string, index: Index, question: string, embed: Embed): Promise<Hit[]> {
  if (!question.trim()) return []
  const stored = await load(contextDir)
  const [asked] = await embed([question])
  const q = unit(asked)
  const files = new Map(index.files.map((file) => [file.path, file]))
  const scored: { file: (typeof index.files)[number]; passage: Passage; score: number }[] = []
  for (const [name, entry] of Object.entries(stored.files)) {
    const file = files.get(name)
    if (!file) continue
    for (const passage of entry.passages) {
      const v = unpack(passage.v)
      let score = 0
      for (let i = 0; i < v.length; i++) score += q[i] * v[i]
      scored.push({ file, passage, score: score / 127 })
    }
  }
  return scored
    .filter((each) => each.score >= CLOSE)
    .sort((a, b) => b.score - a.score)
    .slice(0, SHOWN)
    .map(({ file, passage }) => {
      const text = file.text.slice(passage.start, passage.end).replace(/\s+/g, ' ').trim()
      return {
        path: file.path,
        kind: file.kind,
        project: file.project,
        title: file.title,
        before: '',
        match: text.slice(0, 160),
        after: text.length > 160 ? '…' : '',
        start: passage.start,
        length: passage.end - passage.start,
        thread: null
      }
    })
}

/** Null when search by meaning can be had here. Otherwise what is missing, in words for the reader. */
export async function meaningMissing(): Promise<string | null> {
  try {
    const tags = (await (await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(1500) })).json()) as { models?: { name?: string }[] }
    if ((tags.models ?? []).some((each) => each.name === MODEL || each.name?.startsWith(`${MODEL}:`))) return null
    return `Search by meaning needs the ${MODEL} model in Ollama. In a terminal: ollama pull ${MODEL}`
  } catch {
    return `Search by meaning needs Ollama running on this computer, with the ${MODEL} model.`
  }
}

/** Vectors from Ollama on this computer. Nothing is sent anywhere else. */
export const ollamaEmbed: Embed = async (texts) => embedWithOllama(texts)

/** What search by meaning runs on, for the tools of an agent. The app uses Ollama; a test puts a stand-in here. */
export const meaningRuns = { missing: () => meaningMissing(), embed: ((texts) => embedWithOllama(texts)) as Embed }

async function embedWithOllama(texts: string[]): Promise<number[][]> {
  const answer = await fetch(`${OLLAMA}/api/embed`, {
    method: 'POST',
    body: JSON.stringify({ model: MODEL, input: texts }),
    signal: AbortSignal.timeout(300_000)
  })
  if (!answer.ok) throw new Error(`Ollama did not give vectors: ${answer.status}`)
  const { embeddings } = (await answer.json()) as { embeddings?: number[][] }
  if (!Array.isArray(embeddings) || embeddings.length !== texts.length) throw new Error('Ollama gave vectors that do not fit.')
  return embeddings
}
