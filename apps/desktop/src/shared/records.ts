import { metaOf } from './meta'

/**
 * Records: documents whose front matter says `id:`, as the architecture template's decisions, reviews
 * and register items do. Mate only reads them. The rules for what needs attention are the ones of
 * `tools/repo.py report` in that template, so the window and the tool agree.
 */

export type Fields = Record<string, string>

/** What a document says of itself in its front matter: each field, and the choices a field's comment lists. */
export type Header = { fields: Fields; choices: Record<string, string[]>; order: string[] }

/** A value, and the comment after it. A quoted value may hold a `#`. */
function split(raw: string): { value: string; comment: string } {
  const double = /^\s*"((?:[^"\\]|\\.)*)"(.*)$/.exec(raw)
  if (double) return { value: double[1].replace(/\\(.)/g, '$1'), comment: double[2].trim() }
  const quoted = /^\s*'((?:[^']|'')*)'(.*)$/.exec(raw)
  if (quoted) return { value: quoted[1], comment: quoted[2].trim() }
  const hash = /(^|\s)#/.exec(raw)
  return hash ? { value: raw.slice(0, hash.index).trim(), comment: raw.slice(hash.index).trim() } : { value: raw.trim(), comment: '' }
}

/**
 * `# draft | issued | withdrawn` lists the choices of a field, and a note in brackets after them is left
 * off. Free text that happens to hold a bar is not a list of choices.
 */
function choicesIn(comment: string): string[] {
  const options = comment.replace(/^#\s*/, '').replace(/\s*\([^)]*\)\s*$/, '').split('|').map((each) => each.trim())
  return options.length >= 2 && options.every((each) => /^[a-z][a-z0-9-]*$/.test(each)) ? options : []
}

export function headerOf(text: string): Header {
  const header: Header = { fields: {}, choices: {}, order: [] }
  const meta = metaOf(text)
  if (!meta) return header
  for (const line of text.slice(0, meta.to).split('\n').slice(1)) {
    const found = /^([A-Za-z][\w-]*)[ \t]*:(.*)$/.exec(line.replace(/\r$/, ''))
    if (!found) continue
    const { value, comment } = split(found[2])
    header.fields[found[1]] = value
    header.order.push(found[1])
    const choices = choicesIn(comment)
    if (choices.length > 0) header.choices[found[1]] = choices
  }
  return header
}

/** A value as YAML takes it on one line: plain when it can be, in double quotes when a `: `, a ` #` or a leading mark would be read as more. */
function written(value: string): string {
  const plain = value === value.trim() && !/(^|\s)#|:(\s|$)/.test(value) && !/^[\[\]{}>|*&!%@`'"?,-]/.test(value)
  return value === '' || plain ? value : `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * The text with one field of the front matter set, its comment and the comment's column kept. A field
 * that is not there is added at the end of the block, and a document with no block gets one at the top.
 * `null` takes the field out, with the list or the lines indented under it. A value that is more than
 * one line is no value: the text is returned as it is. `tags` has its own writer, `withTags`.
 */
export function withField(text: string, key: string, value: string | null): string {
  if (!/^[A-Za-z][\w-]*$/.test(key) || key.toLowerCase() === 'tags' || /[\r\n]/.test(value ?? '')) return text
  const meta = metaOf(text)
  // A file with Windows line ends is no front matter to Mate (`metaOf`), so a block is not made over its own.
  if (!meta) return value === null || text.startsWith('---\r\n') ? text : `---\n${key}: ${written(value)}\n---\n${text}`
  const lines = text.slice(0, meta.to).split('\n')
  const close = lines.findIndex((each, at) => at > 0 && /^(?:---|\.\.\.)[ \t]*$/.test(each))
  if (close < 0) return text
  for (let at = 1; at < close; at++) {
    const found = new RegExp(`^${key}[ \\t]*:(.*)$`).exec(lines[at])
    if (!found) continue
    if (value === null) {
      let end = at + 1
      while (end < close && /^([ \t]+\S|[ \t]*-[ \t])/.test(lines[end])) end++
      lines.splice(at, end - at)
      // A block left with nothing in it goes.
      if (lines.slice(1, close - (end - at)).every((each) => each.trim() === '')) return text.slice(meta.to)
      return lines.join('\n') + text.slice(meta.to)
    }
    const { comment } = split(found[1])
    let next = `${key}: ${written(value)}`.trimEnd()
    if (comment) next = next.padEnd(Math.max(lines[at].indexOf(comment), next.length + 1)) + comment
    lines[at] = next
    return lines.join('\n') + text.slice(meta.to)
  }
  if (value === null) return text
  lines.splice(close, 0, `${key}: ${written(value)}`.trimEnd())
  return lines.join('\n') + text.slice(meta.to)
}

/**
 * Each field of the front matter that a person can change in a box: one line, a value or nothing. A
 * list, a map or a block of text is `compound`, and is left to the file. `tags` has its own place.
 */
export function propsOf(text: string): { key: string; value: string; compound: boolean }[] {
  const meta = metaOf(text)
  if (!meta) return []
  const lines = text.slice(0, meta.to).split('\n').map((each) => each.replace(/\r$/, ''))
  const found: { key: string; value: string; compound: boolean }[] = []
  for (let at = 1; at < lines.length; at++) {
    const head = /^([A-Za-z][\w-]*)[ \t]*:(.*)$/.exec(lines[at])
    if (!head) continue
    const { value } = split(head[2])
    const next = lines[at + 1] ?? ''
    const compound = /^[[{|>]/.test(value) || (value === '' && /^([ \t]+\S|[ \t]*-[ \t])/.test(next))
    if (head[1].toLowerCase() !== 'tags') found.push({ key: head[1], value: compound ? '' : value, compound })
  }
  return found
}

/** One record, as the list shows it. */
export type RecordRow = { path: string; id: string; title: string; status: string; owner: string; fields: Fields }

const ID = /^[A-Z][A-Z0-9]*-\d+$/

/** The record a document is, by its path from the project, or null. A template (a folder or a file that starts with `_`) is not one. */
export function recordOf(path: string, text: string): RecordRow | null {
  if (!path.toLowerCase().endsWith('.md') || path.split('/').some((part) => part.startsWith('_'))) return null
  const { fields } = headerOf(text)
  if (!fields.id) return null
  return { path, id: fields.id, title: fields.title ?? '', status: fields.status ?? '', owner: fields.owner ?? '', fields }
}

/** The group a record is listed in: the letters of its ID, `ADR`, `REV`, `REG`. A project's key has none. */
export const groupOf = (record: RecordRow): string => (ID.test(record.id) ? record.id.split('-')[0] : '')

const DAY = /^\d{4}-\d{2}-\d{2}$/
const day = (value: string | undefined) => (value && DAY.test(value) ? value : null)
const CLOSED = new Set(['closed', 'withdrawn', 'superseded', 'rejected'])
export const isClosed = (record: RecordRow) => CLOSED.has(record.status)

export type Attention = {
  record: RecordRow
  why: 'overdue' | 'soon' | 'no owner' | 'no decision' | 'waiting for a decision'
  /** For a deadline: the day, and what falls due. */
  date?: string
  what?: string
}

const gap = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)

/**
 * What needs the reader, as `repo.py report` lists it: open register items past their due or review
 * day or coming up, accepted decisions to review, reviews still a draft past their due day, items
 * with no owner, deviations with no decision, and decisions still proposed. `today` is `YYYY-MM-DD`.
 */
export function attention(records: RecordRow[], today: string, days = 30): Attention[] {
  const dated: Attention[] = []
  const rest: Attention[] = []
  for (const record of records) {
    const prefix = record.id.split('-')[0]
    const when: [string, string][] = []
    if (prefix === 'REG' && record.status !== 'closed') when.push(['due', 'due'], ['review', 'review'])
    if (prefix === 'ADR' && record.status === 'accepted') when.push(['review', 'decision to review'])
    if (prefix === 'REV' && record.status === 'draft') when.push(['due', 'opinion due'])
    for (const [field, what] of when) {
      const date = day(record.fields[field])
      if (date && gap(today, date) <= days) dated.push({ record, why: date < today ? 'overdue' : 'soon', date, what })
    }
    if (prefix === 'REG' && record.status !== 'closed') {
      if (!record.owner) rest.push({ record, why: 'no owner' })
      if (record.fields.type === 'deviation' && !record.fields.decision) rest.push({ record, why: 'no decision' })
    }
    if (prefix === 'ADR' && record.status === 'proposed') rest.push({ record, why: 'waiting for a decision' })
  }
  return [...dated.sort((a, b) => a.date!.localeCompare(b.date!)), ...rest]
}

/**
 * What an ID in the text opens, by the ID: a record's own, a standard or a pattern by its file name
 * (`STD-IAM-privileged-access`), and a principle (`P-01`) by the heading in a `principles.md`. The
 * paths count from the project.
 */
export function refsOf(files: { path: string; text: string }[], records: RecordRow[]): Record<string, string> {
  const refs: Record<string, string> = {}
  for (const file of files) {
    const name = file.path.split('/').pop()!.replace(/\.md$/i, '')
    if (/^(STD|PAT)-/.test(name) && file.path.toLowerCase().endsWith('.md') && !file.path.split('/').some((part) => part.startsWith('_'))) refs[name] = file.path
    if (name.toLowerCase() === 'principles') for (const found of file.text.matchAll(/^#{1,6}[ \t]+(P-\d+)\b/gm)) refs[found[1]] = file.path
  }
  for (const record of records) if (ID.test(record.id)) refs[record.id] = record.path
  return refs
}

export type RefRange = { start: number; end: number; path: string }

/** Where the text names something `refs` knows, as a whole word: `ADR-0001`, not the `ADR-00` of `ADR-0010`. */
export function refRanges(text: string, refs: Record<string, string>): RefRange[] {
  const keys = Object.keys(refs).sort((a, b) => b.length - a.length)
  if (keys.length === 0) return []
  const found = new RegExp(`(?<![\\w-])(?:${keys.map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\w-])`, 'g')
  return [...text.matchAll(found)].map((each) => ({ start: each.index, end: each.index + each[0].length, path: refs[each[0]] }))
}
