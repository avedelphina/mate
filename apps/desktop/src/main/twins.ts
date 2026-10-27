import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isTwinned, twinOf } from '../shared/twin'

/**
 * Text twins: the text of each PDF, Word file and table of a context, taken out once and kept in
 * `.indexes/text/`, so that search, the page and agents can read what Mate cannot draw. A twin is
 * a helper like the index: it is made again from the file, and deleting it loses nothing.
 *
 * The text is taken out by the system's own tools, each in a process of its own, and nothing
 * leaves the computer: a PDF by Mate's helper, which asks PDFKit, an Excel workbook by `unzip`, and
 * anything else by `textutil`. All come with macOS. On another system nothing is twinned.
 */

// ponytail: PDF, tables, and what textutil reads. Slides wait for a tool that comes with the
// system. A scanned page is read off its picture, in Czech and English: there is no Slovak model.
const MAX_SOURCE = 50 * 1024 * 1024
const MAX_TEXT = 2 * 1024 * 1024
// What a twin is made with. When it changes, every twin is made again: twins made before scans
// were read hold nothing for a scan, and their files have not changed since.
const VERSION = '2'

const run = (command: string, args: string[], input?: Buffer, seconds = 60) =>
  new Promise<string>((resolve, reject) => {
    const child = execFile(command, args, { timeout: seconds * 1000, maxBuffer: 8 * MAX_TEXT, encoding: 'utf8' }, (failed, out) =>
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
  const lower = file.toLowerCase()
  if (lower.endsWith('.xlsx')) return workbook(file)
  if (lower.endsWith('.csv') || lower.endsWith('.tsv')) return decoded(await readFile(file))
  if (lower.endsWith('.pdf')) {
    // A scan is read off its pictures, a fraction of a second a page, and the first takes longer while the model loads.
    const answer = JSON.parse(await run(helper, ['--pdf'], await readFile(file), 600)) as { text?: unknown; error?: unknown }
    if (typeof answer.text !== 'string') throw new Error(String(answer.error ?? 'The helper read no text.'))
    return answer.text
  }
  return run('/usr/bin/textutil', ['-convert', 'txt', '-stdout', path.resolve(file)])
}

// ponytail: a file that is not UTF-8 is read as Central European Windows text, which is what Excel
// writes a CSV in on a Czech or Slovak system. Ask which, if tables from elsewhere come out wrong.
const decoded = (bytes: Buffer): string => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1250').decode(bytes)
  }
}

const unescape = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, code: string) =>
    code[0] === '#'
      ? String.fromCodePoint(code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1)))
      : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[code.toLowerCase()]
  )
const attribute = (tag: string, name: string): string => unescape(new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? '')
/** The text of every <t> in a piece of a workbook, run together: a cell of rich text has several. */
const texts = (xml: string): string => [...xml.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((each) => unescape(each[1])).join('')

/**
 * The cells of an Excel workbook, each sheet as a markdown table under its name, so the page draws
 * it as a table and a passage found by meaning keeps its rows. A workbook is a zip of XML files: the
 * system's `unzip` gives each one, and its cells are read off it. Formulas give the value they last
 * had. Columns empty all the way down are left out.
 */
// ponytail: the XML is read with patterns, not parsed: what Excel and its likes write is regular. A
// date is the number Excel keeps for it. Parse properly if a workbook from another tool comes out empty.
async function workbook(file: string): Promise<string> {
  const part = (name: string) => run('/usr/bin/unzip', ['-p', path.resolve(file), name]).catch(() => '')
  const shared = [...(await part('xl/sharedStrings.xml')).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((each) => texts(each[1]))
  const targets = new Map(
    [...(await part('xl/_rels/workbook.xml.rels')).matchAll(/<Relationship\b[^>]*>/g)].map((each) => [attribute(each[0], 'Id'), attribute(each[0], 'Target')])
  )
  const out: string[] = []
  for (const sheet of (await part('xl/workbook.xml')).matchAll(/<sheet\b[^>]*>/g)) {
    const target = targets.get(attribute(sheet[0], 'r:id')) ?? ''
    const xml = target ? await part(target.startsWith('/') ? target.slice(1) : `xl/${target}`) : ''
    const rows: string[][] = []
    for (const row of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const cells: string[] = []
      for (const cell of (row[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const [type, body] = [attribute(cell[1], 't'), cell[2] ?? '']
        const value = unescape(/<v>([^<]*)<\/v>/.exec(body)?.[1] ?? '')
        const text = type === 's' ? (shared[Number(value)] ?? '') : type === 'inlineStr' ? texts(body) : type === 'b' ? (value === '1' ? 'TRUE' : 'FALSE') : value
        const letters = attribute(cell[1], 'r').replace(/\d+$/, '')
        const at = letters ? [...letters].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1 : cells.length
        cells[at] = text.replace(/\s+/g, ' ').trim().replaceAll('|', '\\|')
      }
      if (cells.some(Boolean)) rows.push(cells)
    }
    if (rows.length === 0) continue
    const used = [...new Set(rows.flatMap((cells) => Object.keys(cells).filter((at) => cells[Number(at)]).map(Number)))].sort((a, b) => a - b)
    const line = (cells: string[]) => `| ${used.map((at) => cells[at] ?? '').join(' | ')} |`
    out.push(`## ${attribute(sheet[0], 'name')}`, '', line(rows[0]), `|${' --- |'.repeat(used.length)}`, ...rows.slice(1).map(line), '')
  }
  return out.join('\n')
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
  const marked = path.join(contextDir, '.indexes', 'text', '.version')
  const current = (await readFile(marked, 'utf8').catch(() => '')).trim() === VERSION
  const due: string[] = []
  for (const relative of sources) {
    const twin = await stat(path.join(contextDir, twinOf(relative))).catch(() => null)
    const source = await stat(path.join(contextDir, relative))
    if (source.size <= MAX_SOURCE && (!current || !twin || twin.mtimeMs < source.mtimeMs)) due.push(relative)
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
  if (!current) {
    await mkdir(path.dirname(marked), { recursive: true })
    await writeFile(marked, VERSION)
  }
  const wanted = new Set(sources)
  for (const relative of await twins(path.join(contextDir, '.indexes', 'text'))) {
    if (wanted.has(relative)) continue
    await rm(path.join(contextDir, twinOf(relative)), { force: true })
    changed++
  }
  return changed
}
