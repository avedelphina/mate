import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isTwinned, twinOf } from '../shared/twin'

/**
 * Text twins: the text of each PDF and Word file of a context, taken out once and kept in
 * `.indexes/text/`, so that search, the page and agents can read what Mate cannot draw. A twin is
 * a helper like the index: it is made again from the file, and deleting it loses nothing.
 *
 * The text is taken out by the system's own tools, each in a process of its own, and nothing
 * leaves the computer: a PDF by Mate's helper, which asks PDFKit, and anything else by `textutil`.
 * Both come with macOS. On another system nothing is twinned.
 */

// ponytail: PDF and what textutil reads. Slides and spreadsheets wait for a tool that comes with
// the system; a scanned PDF has no text until there is OCR.
const MAX_SOURCE = 50 * 1024 * 1024
const MAX_TEXT = 2 * 1024 * 1024

const run = (command: string, args: string[], input?: Buffer) =>
  new Promise<string>((resolve, reject) => {
    const child = execFile(command, args, { timeout: 60_000, maxBuffer: 8 * MAX_TEXT, encoding: 'utf8' }, (failed, out) =>
      failed ? reject(failed) : resolve(out)
    )
    child.stdin?.on('error', () => {})
    child.stdin?.end(input)
  })

/**
 * The text of one file. `file` is a full path the caller has checked. A PDF goes to the helper as
 * bytes, so the helper never names a path; textutil is given the path, which begins with a slash
 * and so is never read as an option.
 */
export async function extract(file: string, helper: string): Promise<string> {
  if (file.toLowerCase().endsWith('.pdf')) {
    const answer = JSON.parse(await run(helper, ['--pdf'], await readFile(file))) as { text?: unknown; error?: unknown }
    if (typeof answer.text !== 'string') throw new Error(String(answer.error ?? 'The helper read no text.'))
    return answer.text
  }
  return run('/usr/bin/textutil', ['-convert', 'txt', '-stdout', path.resolve(file)])
}

/** Every file of the context that gets a twin. Hidden folders are skipped, so twins are never twinned. */
async function walk(contextDir: string, base = ''): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(path.join(contextDir, base), { withFileTypes: true }).catch(() => [])) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const relative = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) found.push(...(await walk(contextDir, relative)))
    else if (entry.isFile() && isTwinned(relative)) found.push(relative)
  }
  return found
}

/** The twins on disk, by the path of the file each is the text of. */
async function twins(dir: string, base = ''): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(path.join(dir, base), { withFileTypes: true }).catch(() => [])) {
    const relative = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) found.push(...(await twins(dir, relative)))
    else if (entry.isFile() && relative.endsWith('.txt')) found.push(relative.slice(0, -4))
  }
  return found
}

/**
 * Bring the twins of a context up to date: make the ones missing or older than their file, and
 * take away the ones whose file is gone. A file that cannot be read gets an empty twin, so it is
 * not tried again until it changes. `left` hears how many files are still to read.
 * Gives the number of twins made or taken away.
 */
export async function refreshTwins(contextDir: string, helper: string, left: (count: number) => void = () => {}): Promise<number> {
  if (process.platform !== 'darwin') return 0
  const sources = await walk(contextDir)
  const due: string[] = []
  for (const relative of sources) {
    const twin = await stat(path.join(contextDir, twinOf(relative))).catch(() => null)
    const source = await stat(path.join(contextDir, relative))
    if (source.size <= MAX_SOURCE && (!twin || twin.mtimeMs < source.mtimeMs)) due.push(relative)
  }
  let changed = 0
  for (const [done, relative] of due.entries()) {
    left(due.length - done)
    let text = ''
    // A PDF needs the helper. Without it, a PDF waits for the next time, and is not marked as unreadable.
    if (relative.toLowerCase().endsWith('.pdf') && !existsSync(helper)) continue
    try {
      text = (await extract(path.join(contextDir, relative), helper)).slice(0, MAX_TEXT)
    } catch {
      // Locked, damaged, or not what its name says. An empty twin says so until the file changes.
    }
    const file = path.join(contextDir, twinOf(relative))
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(`${file}.tmp`, text)
    await rename(`${file}.tmp`, file)
    changed++
  }
  left(0)
  const wanted = new Set(sources)
  for (const relative of await twins(path.join(contextDir, '.indexes', 'text'))) {
    if (wanted.has(relative)) continue
    await rm(path.join(contextDir, twinOf(relative)), { force: true })
    changed++
  }
  return changed
}
