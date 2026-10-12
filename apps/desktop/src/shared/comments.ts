export type ReviewComment = {
  id: string
  anchor: string
  text: string
  author: string
}

const OPEN = '<!-- @comment'
const CLOSE = '-->'

/** What a marker holds. Fields Mate does not know are carried along untouched. */
type Stored = Record<string, unknown> & { anchor: string; text: string }
type Marker = { start: number; end: number; value: Stored }

/** Every marker whose body parses, with where it sits in the file. Malformed JSON is skipped. */
function scan(markdown: string): Marker[] {
  const markers: Marker[] = []
  let from = 0
  while (from < markdown.length) {
    const start = markdown.indexOf(OPEN, from)
    if (start < 0) break
    const bodyStart = start + OPEN.length
    let end = bodyStart
    let parsed = false
    while (end < markdown.length) {
      end = markdown.indexOf(CLOSE, end)
      if (end < 0) break
      try {
        const value = JSON.parse(markdown.slice(bodyStart, end).trim()) as Partial<Stored>
        if (typeof value.anchor === 'string' && typeof value.text === 'string') {
          markers.push({ start, end: end + CLOSE.length, value: value as Stored })
        }
        from = end + CLOSE.length
        parsed = true
        break
      } catch {
        end += CLOSE.length
      }
    }
    if (!parsed) from = bodyStart
  }
  return markers
}

function toComment(value: Stored): ReviewComment {
  return {
    id: String(value.id ?? ''),
    anchor: value.anchor,
    text: value.text,
    author: String(value.author ?? '')
  }
}

/** Markers md-redline can read. Malformed JSON is ignored. */
export function parseComments(markdown: string): ReviewComment[] {
  return scan(markdown).map((marker) => toComment(marker.value))
}

/**
 * The document as the reader sees it: markers cut out, line endings as \n.
 * raw[i] is where visible character i sits in the file.
 */
function strip(markdown: string) {
  const markers = scan(markdown)
  // A marker alone on its line takes the whole line with it.
  const spans = markers.map(({ start, end }) => {
    const lineStart = markdown.lastIndexOf('\n', start - 1) + 1
    const lineBreak = markdown.indexOf('\n', end)
    const lineEnd = lineBreak < 0 ? markdown.length : lineBreak + 1
    const alone = !markdown.slice(lineStart, start).trim() && !markdown.slice(end, lineEnd).trim()
    return alone ? [lineStart, lineEnd] : [start, end]
  })
  const raw: number[] = []
  let text = ''
  let next = 0
  for (let i = 0; i < markdown.length; i += 1) {
    if (next < spans.length && i === spans[next][0]) {
      i = spans[next][1] - 1
      next += 1
      continue
    }
    if (markdown[i] === '\r' && markdown[i + 1] === '\n') continue
    text += markdown[i]
    raw.push(i)
  }
  raw.push(markdown.length)
  return { markers, text, raw }
}

/** The text to show and the comments stored in it. */
export function readDocument(markdown: string): { text: string; comments: ReviewComment[] } {
  const { markers, text } = strip(markdown)
  return { text, comments: markers.map((marker) => toComment(marker.value)) }
}

/** The line ending the file already uses. */
function eolOf(markdown: string): string {
  return markdown.includes('\r\n') ? '\r\n' : '\n'
}

/**
 * Write a marker on the line under its anchor, after the markers already attached there.
 * `from` is where the reader selected the passage, counted in the visible text.
 * It picks between two places that read the same.
 */
function place(markdown: string, value: Stored, from: number): string {
  const { text, raw } = strip(markdown)
  let start = text.indexOf(value.anchor, from)
  if (start < 0) start = text.indexOf(value.anchor)
  if (start < 0) throw new Error('That text is not in this document.')

  let lineBreak = markdown.indexOf('\n', raw[start + value.anchor.length - 1])
  while (lineBreak >= 0) {
    const following = markdown.indexOf('\n', lineBreak + 1)
    if (!markdown.slice(lineBreak + 1, following < 0 ? undefined : following).includes(OPEN)) break
    lineBreak = following
  }

  const marker = OPEN + JSON.stringify(value) + ' ' + CLOSE
  const eol = eolOf(markdown)
  if (lineBreak < 0) return markdown + eol + marker
  return markdown.slice(0, lineBreak + 1) + marker + eol + markdown.slice(lineBreak + 1)
}

/**
 * Insert one comment on the line after its anchor.
 * The anchor is a passage of the visible text. It may run over several lines.
 */
export function insertComment(markdown: string, anchor: string, text: string, author: string, from = 0): string {
  const trimmedAnchor = anchor.replace(/\r\n/g, '\n').trim()
  const trimmedText = text.trim()
  const trimmedAuthor = author.trim() || 'you'
  if (!trimmedAnchor) throw new Error('Select the sentence the comment is about.')
  if (!trimmedText) throw new Error('The comment is empty.')

  const used = parseComments(markdown)
    .map((comment) => Number(comment.id))
    .filter((id) => Number.isInteger(id))
  const id = String((used.length > 0 ? Math.max(...used) : 0) + 1)
  return place(markdown, { id, anchor: trimmedAnchor, text: trimmedText, author: trimmedAuthor }, from)
}
