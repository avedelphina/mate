import { inflateRawSync } from 'node:zlib'

/**
 * A Word file (.docx) as markdown, with no program and no agent: it is a zip of XML that says which
 * paragraphs are headings, which are list items, and where the tables and the bold are. Pictures,
 * footnotes, headers and footers are left out. The file is the reader's own, and still read as
 * something that may be hostile: a size is capped before anything is unpacked, and nothing in it is run.
 */

// ponytail: each part of the zip may unpack to this much, and the zip may hold this many parts. A longer
// document is read in pieces by the text twin, which has no such ceiling.
const MAX_PART = 64 * 1024 * 1024
const MAX_PARTS = 5000

/** The parts of a zip that are asked for, by name. Zip64 and encryption are not read. */
function unzip(zip: Buffer, wanted: string[]): Map<string, Buffer> {
  let end = -1
  for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - 65535); at -= 1) {
    if (zip.readUInt32LE(at) === 0x06054b50) {
      end = at
      break
    }
  }
  if (end < 0) throw new Error('That is not a Word file: it is not a zip.')
  const count = zip.readUInt16LE(end + 10)
  if (count > MAX_PARTS || count === 0xffff) throw new Error('That Word file has too many parts to read here.')
  let at = zip.readUInt32LE(end + 16)
  const found = new Map<string, Buffer>()
  for (let part = 0; part < count; part += 1) {
    if (at + 46 > zip.length || zip.readUInt32LE(at) !== 0x02014b50) throw new Error('That Word file is damaged.')
    const flags = zip.readUInt16LE(at + 8)
    const method = zip.readUInt16LE(at + 10)
    const size = zip.readUInt32LE(at + 20)
    const length = zip.readUInt32LE(at + 24)
    const name = zip.toString('utf8', at + 46, at + 46 + zip.readUInt16LE(at + 28))
    const local = zip.readUInt32LE(at + 42)
    at += 46 + zip.readUInt16LE(at + 28) + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32)
    if (!wanted.includes(name)) continue
    if (flags & 1) throw new Error('That Word file is encrypted.')
    if (length > MAX_PART || local + 30 > zip.length || zip.readUInt32LE(local) !== 0x04034b50) throw new Error('That Word file is too large, or damaged.')
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    const data = zip.subarray(start, start + size)
    if (method === 0) found.set(name, data)
    else if (method === 8) found.set(name, inflateRawSync(data, { maxOutputLength: MAX_PART }))
    else throw new Error('That Word file is compressed in a way that is not read here.')
  }
  return found
}

type Node = { name: string; attrs: Record<string, string>; children: Node[]; text: string }

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decode = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ''
    }
    return ENTITIES[code] ?? whole
  })

/** The XML as a tree. Names keep their prefix (`w:p`). Comments, instructions and CDATA are read as they are. */
function parse(xml: string): Node {
  const root: Node = { name: '', attrs: {}, children: [], text: '' }
  const stack = [root]
  const token = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g
  for (let found = token.exec(xml); found; found = token.exec(xml)) {
    const top = stack[stack.length - 1]
    if (found[1] !== undefined) top.text += found[1]
    else if (found[6] !== undefined) top.text += decode(found[6])
    else if (found[3]) {
      if (found[2]) {
        if (stack.length > 1) stack.pop()
        continue
      }
      const attrs: Record<string, string> = {}
      for (const pair of found[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[pair[1]] = decode(pair[2] ?? pair[3] ?? '')
      const node: Node = { name: found[3], attrs, children: [], text: '' }
      top.children.push(node)
      if (!found[5]) stack.push(node)
    }
  }
  return root
}

const child = (node: Node | undefined, name: string): Node | undefined => node?.children.find((each) => each.name === name)
const kids = (node: Node | undefined, name: string): Node[] => node?.children.filter((each) => each.name === name) ?? []
const val = (node: Node | undefined): string | undefined => node?.attrs['w:val']
/** A switch such as `<w:b/>`: on unless it says it is off. */
const on = (node: Node | undefined): boolean => node !== undefined && !['0', 'false', 'off', 'none'].includes((val(node) ?? '').toLowerCase())

type Style = { name: string; outline: number | null; list: { id: string; level: number } | null }

function styles(xml: string | undefined): Map<string, Style> {
  const found = new Map<string, Style>()
  if (!xml) return found
  for (const style of kids(child(parse(xml), 'w:styles'), 'w:style')) {
    const id = style.attrs['w:styleId']
    if (!id) continue
    const ppr = child(style, 'w:pPr')
    const outline = val(child(ppr, 'w:outlineLvl'))
    const numbering = child(ppr, 'w:numPr')
    found.set(id, {
      name: (val(child(style, 'w:name')) ?? id).toLowerCase(),
      outline: outline !== undefined && /^\d$/.test(outline) ? Number(outline) : null,
      list: numbering && val(child(numbering, 'w:numId')) ? { id: val(child(numbering, 'w:numId'))!, level: Number(val(child(numbering, 'w:ilvl')) ?? 0) } : null
    })
  }
  return found
}

/** For each list and level, whether it counts (`1.`) or has bullets. */
function numbering(xml: string | undefined): (id: string, level: number) => 'bullet' | 'number' {
  const abstracts = new Map<string, Map<number, string>>()
  const lists = new Map<string, string>()
  if (xml) {
    const root = child(parse(xml), 'w:numbering')
    for (const abstract of kids(root, 'w:abstractNum')) {
      const levels = new Map<number, string>()
      for (const level of kids(abstract, 'w:lvl')) levels.set(Number(level.attrs['w:ilvl'] ?? 0), val(child(level, 'w:numFmt')) ?? 'bullet')
      abstracts.set(abstract.attrs['w:abstractNumId'] ?? '', levels)
    }
    for (const list of kids(root, 'w:num')) lists.set(list.attrs['w:numId'] ?? '', val(child(list, 'w:abstractNumId')) ?? '')
  }
  return (id, level) => {
    const format = abstracts.get(lists.get(id) ?? '')?.get(level)
    return format === undefined || format === 'bullet' || format === 'none' ? 'bullet' : 'number'
  }
}

/** Where each `r:id` of the document points, for the links. */
function links(xml: string | undefined): Map<string, string> {
  const found = new Map<string, string>()
  if (!xml) return found
  for (const rel of kids(child(parse(xml), 'Relationships'), 'Relationship')) {
    if (rel.attrs.TargetMode === 'External' && /^(https?:|mailto:)/i.test(rel.attrs.Target ?? '')) found.set(rel.attrs.Id ?? '', rel.attrs.Target)
  }
  return found
}

type Piece = { text: string; bold: boolean; italic: boolean }

/** The words of a paragraph, as pieces that are alike inside, with a link as one piece of its own. */
function pieces(paragraph: Node, targets: Map<string, string>): Piece[] {
  const out: Piece[] = []
  const add = (text: string, bold: boolean, italic: boolean) => {
    if (!text) return
    const last = out[out.length - 1]
    if (last && last.bold === bold && last.italic === italic) last.text += text
    else out.push({ text, bold, italic })
  }
  const run = (node: Node) => {
    const properties = child(node, 'w:rPr')
    const bold = on(child(properties, 'w:b'))
    const italic = on(child(properties, 'w:i'))
    for (const part of node.children) {
      if (part.name === 'w:t') add(part.text, bold, italic)
      else if (part.name === 'w:tab') add(' ', bold, italic)
      else if (part.name === 'w:br' && part.attrs['w:type'] !== 'page') add('  \n', bold, italic)
      else if (part.name === 'w:noBreakHyphen') add('-', bold, italic)
    }
  }
  const walk = (node: Node) => {
    for (const part of node.children) {
      if (part.name === 'w:r') run(part)
      else if (part.name === 'w:hyperlink') {
        const target = targets.get(part.attrs['r:id'] ?? '')
        const inner = pieces(part, targets)
        const text = inner.map((each) => each.text).join('')
        if (target && text.trim()) add(`[${text.trim()}](${target.replace(/[()\s]/g, encodeURIComponent)})`, false, false)
        else for (const each of inner) add(each.text, each.bold, each.italic)
      } else if (part.name === 'w:ins' || part.name === 'w:smartTag' || part.name === 'w:sdt' || part.name === 'w:sdtContent') walk(part)
    }
  }
  walk(paragraph)
  return out
}

/** Bold and italic around the words, with the spaces outside, as markdown wants them. */
function marked(parts: Piece[]): string {
  return parts
    .map(({ text, bold, italic }) => {
      const core = text.replace(/^\s+|\s+$/g, '')
      if (!core || (!bold && !italic)) return text
      const mark = bold && italic ? '***' : bold ? '**' : '*'
      return `${text.slice(0, text.indexOf(core))}${mark}${core}${mark}${text.slice(text.indexOf(core) + core.length)}`
    })
    .join('')
}

/** Runs of spaces, tabs and no-break spaces are one space, as the page shows them. A hard break keeps its two. */
const tidy = (text: string): string => text.replace(/[\u00a0\t]/g, ' ').replace(/ {2,}(?!\n)/g, ' ').trim()

/**
 * Whether the words can be a heading: one short line. Not one that ends with a colon, and not one of
 * more than a few words that ends with a full stop or a semicolon, which is a sentence of the text.
 */
function heading(words: string): boolean {
  const plain = words.replace(/\*+/g, '').trim()
  const count = plain.split(/\s+/).length
  if (plain.length > 100 || count > 15 || plain.includes('\n')) return false
  // A line that ends with a comma or a colon, or starts with a small letter, is the middle of a sentence or a lead-in.
  if (/[,:]$/.test(plain) || /^\p{Ll}/u.test(plain)) return false
  return !(/[.;]$/.test(plain) && count > 6)
}

/** A line that would turn into markdown structure when it is not meant to has its first mark shown as text. */
const literal = (text: string): string => text.replace(/^(#{1,6}\s|[-+*>]\s|\d+[.)]\s|>)/, '\\$1')

/** The text of a Word file, as markdown. */
export function docxToMarkdown(file: Buffer): string {
  const parts = unzip(file, ['word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/_rels/document.xml.rels'])
  const document = parts.get('word/document.xml')
  if (!document) throw new Error('That is not a Word document: it has no text part.')
  const text = (name: string) => parts.get(name)?.toString('utf8')
  const known = styles(text('word/styles.xml'))
  const kind = numbering(text('word/numbering.xml'))
  const targets = links(text('word/_rels/document.xml.rels'))

  const paragraph = (node: Node): { kind: string; line: string } | null => {
    const properties = child(node, 'w:pPr')
    const style = known.get(val(child(properties, 'w:pStyle')) ?? '')
    const words = tidy(marked(pieces(node, targets)))
    if (!words) return null

    const named = style?.name ?? (val(child(properties, 'w:pStyle')) ?? '').toLowerCase()
    const outline = val(child(properties, 'w:outlineLvl'))
    let level = /^(?:heading|nadpis)\s*(\d)/.exec(named)?.[1]
    if (!level && named === 'title') level = '1'
    if (!level && named === 'subtitle') level = '2'
    if (!level && outline !== undefined && /^\d$/.test(outline)) level = String(Number(outline) + 1)
    if (!level && style?.outline !== null && style?.outline !== undefined) level = String(style.outline + 1)
    // A heading is one line, and its own bold is the heading's. A paragraph that only has a heading's style, such as a clause that
    // is numbered with one, stays a paragraph: a heading is short, and a line that ends like a sentence or leads into a list is not one.
    if (level && heading(words)) return { kind: 'heading', line: `${'#'.repeat(Math.min(6, Math.max(1, Number(level))))} ${words.replace(/\*\*/g, '').replace(/\s*\n\s*/g, ' ')}` }

    const direct = child(properties, 'w:numPr')
    const list = direct ? { id: val(child(direct, 'w:numId')) ?? '0', level: Number(val(child(direct, 'w:ilvl')) ?? 0) } : style?.list
    if (list && list.id !== '0') {
      const level = Math.min(Math.max(list.level, 0), 8)
      const ordered = kind(list.id, level) === 'number'
      // A bulleted list and a numbered one are two lists, even when one follows the other.
      return { kind: ordered ? 'item-number' : 'item-bullet', line: `${'    '.repeat(level)}${ordered ? '1.' : '-'} ${words.replace(/\n\s*/g, ' ')}` }
    }
    return { kind: 'text', line: literal(words) }
  }

  const table = (node: Node): string => {
    const rows = kids(node, 'w:tr').map((row) =>
      kids(row, 'w:tc').flatMap((cell) => {
        const words = kids(cell, 'w:p')
          .map((each) => tidy(marked(pieces(each, targets)).replace(/\s*\n\s*/g, ' ')))
          .filter(Boolean)
          .join(' ')
          // A backslash before a pipe would turn the escape of the pipe into an escaped backslash.
          .replace(/\\(?=\|)|\|/g, (mark) => `\\${mark}`)
        const span = Number(val(child(child(cell, 'w:tcPr'), 'w:gridSpan')) ?? 1)
        return [words, ...Array.from({ length: Math.min(Math.max(span, 1), 50) - 1 }, () => '')]
      })
    )
    const width = Math.max(0, ...rows.map((row) => row.length))
    if (width === 0) return ''
    const line = (row: string[]) => `| ${[...row, ...Array.from({ length: width - row.length }, () => '')].join(' | ')} |`
    return [line(rows[0]), line(Array.from({ length: width }, () => '---')), ...rows.slice(1).map(line)].join('\n')
  }

  const blocks: { kind: string; line: string }[] = []
  const body = (node: Node) => {
    for (const part of node.children) {
      if (part.name === 'w:p') {
        const made = paragraph(part)
        if (made) blocks.push(made)
      } else if (part.name === 'w:tbl') {
        const made = table(part)
        if (made) blocks.push({ kind: 'table', line: made })
      } else if (part.name === 'w:sdt' || part.name === 'w:sdtContent' || part.name === 'w:body') body(part)
    }
  }
  body(child(parse(document.toString('utf8')), 'w:document') ?? { name: '', attrs: {}, children: [], text: '' })

  // Items of one list sit together. Everything else is a paragraph of its own.
  return blocks.map((each, at) => (at > 0 && each.kind.startsWith('item') && blocks[at - 1].kind === each.kind ? `\n${each.line}` : `\n\n${each.line}`)).join('').trim() + '\n'
}

/**
 * The text of a PDF as paragraphs. It comes with a line break at the end of each line of the page, so
 * the lines of a paragraph are joined, a word that was split at the end of a line is whole again, and
 * a blank line, or a line that starts a list, is left as it was.
 */
export function reflow(text: string): string {
  return (
    text
      .replace(/\r\n?/g, '\n')
      .split(/\n{2,}/)
      .map((paragraph) => {
        const lines = paragraph.split('\n').map((line) => line.trim()).filter(Boolean)
        let out = ''
        for (const line of lines) {
          if (!out) out = line
          else if (/^([•▪◦·*-]|\d+[.)])\s/.test(line)) out += `\n${line}`
          else if (/[\p{L}]-$/u.test(out) && /^\p{Ll}/u.test(line)) out = out.slice(0, -1) + line
          else out += ` ${line}`
        }
        return out
      })
      .filter(Boolean)
      .join('\n\n') + '\n'
  )
}
