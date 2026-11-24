import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { isTwinned, twinOf } from '../shared/twin'

/**
 * Text twins: the text of each PDF, Word file and table of a context, taken out once and kept in
 * `.indexes/text/`, so that search, the page and agents can read what Mate cannot draw. A twin is
 * a helper like the index: it is made again from the file, and deleting it loses nothing.
 *
 * The text is taken out in a process of its own, and nothing leaves the computer. A Mac uses its
 * own tools and Mate's PDFKit/Vision helper. Linux uses Poppler, Tesseract, LibreOffice and Python,
 * installed separately. Tables are read through `unzip` on both.
 */

// ponytail: PDF, tables, and what the system's document converter reads. Slides wait for a tool.
// Scans are read in Czech and English; the Czech model also reads Slovak but for a letter or two.
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

async function linuxPdf(file: string): Promise<string> {
  const text = await run('pdftotext', ['-enc', 'UTF-8', '-nopgbrk', path.resolve(file), '-'])
  if (text.trim()) return text
  // Check before rendering: without the OCR tool or its languages there is no work to retry while absent.
  const languages = await run('tesseract', ['--list-langs'], undefined, 10)
  if (!/^\s*ces\s*$/m.test(languages) || !/^\s*eng\s*$/m.test(languages)) {
    const missing = new Error('Tesseract needs Czech and English language data.') as NodeJS.ErrnoException
    missing.code = 'ENOENT'
    throw missing
  }
  const dir = await mkdtemp(path.join(tmpdir(), 'mate-ocr-'))
  try {
    await run('pdftoppm', ['-jpeg', '-r', '200', path.resolve(file), path.join(dir, 'page')], undefined, 600)
    const pages = (await readdir(dir)).filter((each) => /^page-\d+\.jpg$/.test(each)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    const out: string[] = []
    for (const page of pages) out.push(await run('tesseract', [path.join(dir, page), 'stdout', '-l', 'ces+eng'], undefined, 120))
    return out.join('\n')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function linuxOffice(file: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'mate-office-'))
  try {
    await run(
      'libreoffice',
      [
        '--headless',
        '--nologo',
        '--nodefault',
        '--nofirststartwizard',
        '--nolockcheck',
        '--norestore',
        `-env:UserInstallation=${pathToFileURL(path.join(dir, 'profile')).href}`,
        '--convert-to',
        'txt:Text (encoded):UTF8',
        '--outdir',
        dir,
        path.resolve(file)
      ],
      undefined,
      120
    )
    const out = (await readdir(dir)).find((each) => each.toLowerCase().endsWith('.txt'))
    if (!out) throw new Error('LibreOffice read no text.')
    return await readFile(path.join(dir, out), 'utf8')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const WEB_ARCHIVE = `
import html.parser, plistlib, sys
class Text(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts, self.hidden = [], 0
    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'): self.hidden += 1
        if tag in ('br', 'p', 'div', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'): self.parts.append('\\n')
    def handle_endtag(self, tag):
        if tag in ('script', 'style'): self.hidden = max(0, self.hidden - 1)
        if tag in ('p', 'div', 'li', 'tr'): self.parts.append('\\n')
    def handle_data(self, data):
        if not self.hidden: self.parts.append(data)
with open(sys.argv[1], 'rb') as source:
    resource = plistlib.load(source)['WebMainResource']
data = resource['WebResourceData']
page = data if isinstance(data, str) else data.decode('utf-8', 'replace')
text = Text()
text.feed(page)
text.close()
print(''.join(text.parts))
`

/**
 * The text of one file. `file` is a full path the caller has checked. A Mac PDF goes to the helper
 * as bytes; the other tools get an absolute path, which is never read as an option.
 */
export async function extract(file: string, helper: string): Promise<string> {
  const lower = file.toLowerCase()
  if (lower.endsWith('.xlsx')) return workbook(file)
  if (lower.endsWith('.csv') || lower.endsWith('.tsv')) return decoded(await readFile(file))
  if (process.platform === 'linux') {
    if (lower.endsWith('.pdf')) return linuxPdf(file)
    if (lower.endsWith('.webarchive')) return run('python3', ['-c', WEB_ARCHIVE, path.resolve(file)])
    return linuxOffice(file)
  }
  if (lower.endsWith('.pdf')) {
    // A scan is read off its pictures, a fraction of a second a page, and the first takes longer while the model loads.
    // A helper that did not finish, or gave no answer, is tried again on the next refresh. Only its own "not a PDF" answer
    // is final: an empty twin then stays until the file changes.
    let raw: string
    try {
      raw = await run(helper, ['--pdf'], await readFile(file), 600)
    } catch (failed) {
      if ((failed as NodeJS.ErrnoException).code === 'ENOENT') throw failed
      throw Object.assign(new Error('The helper did not finish.'), { transient: true })
    }
    let answer: { text?: unknown; error?: unknown }
    try {
      answer = JSON.parse(raw) as { text?: unknown; error?: unknown }
    } catch {
      throw Object.assign(new Error('The helper gave no answer.'), { transient: true })
    }
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

/** The cell styles of a workbook that show a date, by the number of the style: Excel keeps a date as a number and says by the style that it is one. */
function dateStyles(xml: string): Set<number> {
  const BUILT_IN = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58])
  const custom = new Map([...xml.matchAll(/<numFmt\b[^>]*>/g)].map((each) => [Number(attribute(each[0], 'numFmtId')), attribute(each[0], 'formatCode')]))
  // A format holds a date when it has a day, month, year, hour or second outside its quotes and brackets.
  const dated = (format: string) => /[dmyhs]/i.test(format.replace(/"[^"]*"|\[[^\]]*\]|\\.|_.|\*./g, '')) && !/^general$/i.test(format)
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? ''
  const styles = new Set<number>()
  ;[...cellXfs.matchAll(/<xf\b[^>]*>/g)].forEach((each, at) => {
    const id = Number(attribute(each[0], 'numFmtId'))
    if (BUILT_IN.has(id) || (custom.has(id) && dated(custom.get(id)!))) styles.add(at)
  })
  return styles
}

/** The day Excel's number stands for, as 2026-11-24, with the time when it has one. */
function excelDate(value: string): string {
  const serial = Number(value)
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return value
  const at = new Date(Math.round((serial - 25569) * 86_400_000))
  const day = at.toISOString().slice(0, 10)
  return serial % 1 === 0 ? day : `${day} ${at.toISOString().slice(11, 16)}`
}

export type Sheet = { name: string; rows: string[][] }

/**
 * The cells of an Excel workbook, each sheet as rows of text. A workbook is a zip of XML files: the system's `unzip`
 * gives each one, and its cells are read off it. Formulas give the value they last had, and a cell that Excel
 * styles as a date is a date. Columns empty all the way down are left out.
 */
// ponytail: the XML is read with patterns, not parsed: what Excel and its likes write is regular.
// Parse properly if a workbook from another tool comes out empty.
export async function readWorkbook(file: string): Promise<Sheet[]> {
  const part = (name: string) => run('/usr/bin/unzip', ['-p', path.resolve(file), name]).catch(() => '')
  const shared = [...(await part('xl/sharedStrings.xml')).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((each) => texts(each[1]))
  const dates = dateStyles(await part('xl/styles.xml'))
  const targets = new Map(
    [...(await part('xl/_rels/workbook.xml.rels')).matchAll(/<Relationship\b[^>]*>/g)].map((each) => [attribute(each[0], 'Id'), attribute(each[0], 'Target')])
  )
  const sheets: Sheet[] = []
  for (const sheet of (await part('xl/workbook.xml')).matchAll(/<sheet\b[^>]*>/g)) {
    const target = targets.get(attribute(sheet[0], 'r:id')) ?? ''
    const xml = target ? await part(target.startsWith('/') ? target.slice(1) : `xl/${target}`) : ''
    const rows: string[][] = []
    for (const row of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const cells: string[] = []
      for (const cell of (row[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const [type, body] = [attribute(cell[1], 't'), cell[2] ?? '']
        const value = unescape(/<v>([^<]*)<\/v>/.exec(body)?.[1] ?? '')
        let text = type === 's' ? (shared[Number(value)] ?? '') : type === 'inlineStr' ? texts(body) : type === 'b' ? (value === '1' ? 'TRUE' : 'FALSE') : value
        if ((type === '' || type === 'n') && value !== '' && dates.has(Number(attribute(cell[1], 's')))) text = excelDate(value)
        const letters = attribute(cell[1], 'r').replace(/\d+$/, '')
        const at = letters ? [...letters].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1 : cells.length
        cells[at] = text.replace(/\s+/g, ' ').trim()
      }
      if (cells.some(Boolean)) rows.push(cells)
    }
    if (rows.length === 0) continue
    const used = [...new Set(rows.flatMap((cells) => Object.keys(cells).filter((at) => cells[Number(at)]).map(Number)))].sort((a, b) => a - b)
    sheets.push({ name: attribute(sheet[0], 'name'), rows: rows.map((cells) => used.map((at) => cells[at] ?? '')) })
  }
  return sheets
}

/** A workbook as markdown, each sheet a table under its name, so the page draws it as a table and a passage found by meaning keeps its rows. */
async function workbook(file: string): Promise<string> {
  const out: string[] = []
  for (const { name, rows } of await readWorkbook(file)) {
    const line = (cells: string[]) => `| ${cells.map((cell) => cell.replaceAll('|', '\\|')).join(' | ')} |`
    out.push(`## ${name}`, '', line(rows[0]), `|${' --- |'.repeat(rows[0].length)}`, ...rows.slice(1).map(line), '')
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
  if (process.platform !== 'darwin' && process.platform !== 'linux') return 0
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
    // Without the Mac helper or a Linux tool, a file waits rather than being marked as unreadable.
    if (process.platform === 'darwin' && relative.toLowerCase().endsWith('.pdf') && !existsSync(helper)) continue
    try {
      text = (await extract(path.join(contextDir, relative), helper)).slice(0, MAX_TEXT)
    } catch (caught) {
      if ((caught as NodeJS.ErrnoException).code === 'ENOENT') continue
      if ((caught as { transient?: boolean }).transient) continue
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
