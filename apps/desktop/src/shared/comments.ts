import { diffLines } from './diff'

export type Reply = { text: string; author: string }

export type ReviewComment = {
  id: string
  anchor: string
  text: string
  author: string
  /** Text proposed in place of the anchor. Empty means the passage should go. */
  suggestion?: string
  replies: Reply[]
  /** md-redline's `status`. Mate sets it when a suggestion is applied. */
  resolved: boolean
}

/** A comment and where its quote sits in the visible text. Null when the quote is no longer there. */
export type Thread = ReviewComment & { start: number | null }

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
  const replies: unknown[] = Array.isArray(value.replies) ? value.replies : []
  return {
    id: String(value.id ?? ''),
    anchor: value.anchor,
    text: value.text,
    author: String(value.author ?? ''),
    ...(typeof value.suggestion === 'string' ? { suggestion: value.suggestion } : {}),
    replies: replies
      .filter((reply): reply is { text: string; author?: unknown } => typeof (reply as Reply | null)?.text === 'string')
      .map((reply) => ({ text: reply.text, author: String(reply.author ?? '') })),
    resolved: value.status === 'resolved' || value.resolved === true
  }
}

/** A "-->" inside a note would end the HTML comment early for every other reader of the file. */
function write(value: Stored): string {
  return OPEN + JSON.stringify(value).replace(/--(!?)>/g, '--$1\\u003e') + ' ' + CLOSE
}

/** Markers md-redline can read. Malformed JSON is ignored. */
export function parseComments(markdown: string): ReviewComment[] {
  return scan(markdown).map((marker) => toComment(marker.value))
}

/**
 * The document as the reader sees it: markers cut out, line endings as \n.
 * raw[i] is where visible character i sits in the file.
 * Each span is what one marker takes out of the file, and `at` is the visible offset it was cut from.
 */
function strip(markdown: string) {
  const markers = scan(markdown)
  const spans = markers.map(({ start, end }) => {
    const lineStart = markdown.lastIndexOf('\n', start - 1) + 1
    const lineBreak = markdown.indexOf('\n', end)
    const lineEnd = lineBreak < 0 ? markdown.length : lineBreak + 1
    // A marker alone on its line takes the whole line with it.
    const alone = !markdown.slice(lineStart, start).trim() && !markdown.slice(end, lineEnd).trim()
    return alone ? { start: lineStart, end: lineEnd, alone, at: 0 } : { start, end, alone, at: 0 }
  })
  const raw: number[] = []
  let text = ''
  let next = 0
  for (let i = 0; i < markdown.length; i += 1) {
    if (next < spans.length && i === spans[next].start) {
      spans[next].at = text.length
      i = spans[next].end - 1
      next += 1
      continue
    }
    if (markdown[i] === '\r' && markdown[i + 1] === '\n') continue
    text += markdown[i]
    raw.push(i)
  }
  raw.push(markdown.length)
  return { markers, spans, text, raw }
}

/** Where the passage occurs so that it ends on the visible line that ends at `lineEnd`. */
function onLine(text: string, anchor: string, lineEnd: number): number[] {
  const found: number[] = []
  for (let i = text.indexOf(anchor); i >= 0; i = text.indexOf(anchor, i + 1)) {
    const lineBreak = text.indexOf('\n', i + anchor.length)
    const end = lineBreak < 0 ? text.length : lineBreak
    if (end > lineEnd) break
    if (end === lineEnd) found.push(i)
  }
  return found
}

/**
 * Where a comment's quote sits in the visible text, or null when it is gone.
 * Mate writes the marker on the line under the passage. md-redline writes it just before.
 * The quote next to the marker wins over the same words elsewhere in the file.
 */
function locate(text: string, anchor: string, span: { at: number; alone: boolean }): number | null {
  if (!anchor) return null
  const near = span.alone ? onLine(text, anchor, span.at - 1)[0] : text.startsWith(anchor, span.at) ? span.at : undefined
  if (near !== undefined) return near
  const anywhere = text.indexOf(anchor)
  return anywhere < 0 ? null : anywhere
}

/** The text to show and the comments stored in it. */
export function readDocument(markdown: string): { text: string; comments: Thread[] } {
  const { markers, spans, text } = strip(markdown)
  return {
    text,
    comments: markers.map((marker, k) => {
      const comment = toComment(marker.value)
      return { ...comment, start: comment.resolved ? null : locate(text, comment.anchor, spans[k]) }
    })
  }
}

/** The line ending the file already uses. */
function eolOf(markdown: string): string {
  return markdown.includes('\r\n') ? '\r\n' : '\n'
}

function clean(passage: string): string {
  return passage.replace(/\r\n/g, '\n').trim()
}

function indexOfComment(markers: Marker[], id: string): number {
  const index = markers.findIndex((marker) => String(marker.value.id ?? '') === id)
  if (index < 0) throw new Error('That comment is no longer in the file.')
  return index
}

/**
 * Write a marker on the line under its anchor, after the markers already attached there.
 * `from` is where the reader selected the passage, counted in the visible text.
 * It picks between two places that read the same.
 */
function place(markdown: string, value: Stored, from: number): string {
  const { spans, text, raw } = strip(markdown)
  let start = text.indexOf(value.anchor, from)
  if (start < 0) start = text.indexOf(value.anchor)
  if (start < 0) throw new Error('That text is not in this document.')
  const end = start + value.anchor.length

  // The marker names its line, not a place on it. Twice on one line could not be told apart later.
  const visibleBreak = text.indexOf('\n', end)
  if (onLine(text, value.anchor, visibleBreak < 0 ? text.length : visibleBreak).length > 1) {
    throw new Error('Those words occur more than once on that line. Select a little more.')
  }

  const lineBreak = markdown.indexOf('\n', raw[end - 1])
  let cut = lineBreak < 0 ? markdown.length : lineBreak + 1
  for (const span of spans) if (span.alone && span.start === cut) cut = span.end

  const head = markdown.slice(0, cut)
  const eol = eolOf(markdown)
  if (!head.endsWith('\n')) return head + eol + write(value)
  return head + write(value) + eol + markdown.slice(cut)
}

/** Change the stored fields of one comment and leave the rest of the file alone. */
function rewrite(markdown: string, id: string, change: (value: Stored) => Stored): string {
  const markers = scan(markdown)
  const marker = markers[indexOfComment(markers, id)]
  return markdown.slice(0, marker.start) + write(change(marker.value)) + markdown.slice(marker.end)
}

/**
 * Insert one comment on the line after its anchor.
 * The anchor is a passage of the visible text. It may run over several lines.
 * A suggestion is the text proposed in its place. Nothing is replaced until it is applied.
 */
export function insertComment(
  markdown: string,
  anchor: string,
  text: string,
  author: string,
  from = 0,
  suggestion?: string
): string {
  const trimmedAnchor = clean(anchor)
  const trimmedText = text.trim()
  const trimmedAuthor = author.trim() || 'you'
  const replacement = suggestion === undefined || clean(suggestion) === trimmedAnchor ? undefined : clean(suggestion)
  if (!trimmedAnchor) throw new Error('Select the sentence the comment is about.')
  if (!trimmedText && replacement === undefined) throw new Error('The comment is empty.')

  const used = parseComments(markdown)
    .map((comment) => Number(comment.id))
    .filter((id) => Number.isInteger(id))
  const id = String((used.length > 0 ? Math.max(...used) : 0) + 1)
  const value: Stored = { id, anchor: trimmedAnchor, text: trimmedText, author: trimmedAuthor }
  if (replacement !== undefined) value.suggestion = replacement
  return place(markdown, value, from)
}

/** Add a reply to a comment's thread. The reply has the shape md-redline reads. */
export function addReply(markdown: string, id: string, text: string, author: string): string {
  const trimmedText = text.trim()
  if (!trimmedText) throw new Error('The reply is empty.')
  return rewrite(markdown, id, (value) => {
    const replies: unknown[] = Array.isArray(value.replies) ? value.replies : []
    const reply = {
      id: `${id}.${replies.length + 1}`,
      text: trimmedText,
      author: author.trim() || 'you',
      timestamp: new Date().toISOString()
    }
    return { ...value, replies: [...replies, reply] }
  })
}

/** Replace the quoted passage with the comment's suggestion, and mark the comment resolved. */
export function applySuggestion(markdown: string, id: string): string {
  const marked = rewrite(markdown, id, (value) => {
    if (typeof value.suggestion !== 'string') throw new Error('This comment suggests no replacement.')
    if (toComment(value).resolved) throw new Error('This suggestion is already applied.')
    return { ...value, status: 'resolved' }
  })
  const { markers, spans, text, raw } = strip(marked)
  const index = indexOfComment(markers, id)
  const { anchor, suggestion } = markers[index].value as Stored & { suggestion: string }
  const start = locate(text, anchor, spans[index])
  if (start === null) throw new Error('The quoted text is no longer in the file. Anchor the comment to a passage first.')

  const from = raw[start]
  const to = raw[start + anchor.length - 1] + 1
  // A marker caught inside the passage is another comment. It is kept, and moves under the new text.
  const caught = spans
    .filter((span) => span.start > from && span.start < to)
    .map((span) => marked.slice(span.start, span.end))
    .join('')
  const eol = eolOf(marked)
  const lineBreak = marked.indexOf('\n', to)
  const cut = lineBreak < 0 ? marked.length : lineBreak + 1
  let rest = marked.slice(to, cut)
  if (caught && !rest.endsWith('\n')) rest += eol
  return marked.slice(0, from) + suggestion.replace(/\n/g, eol) + rest + caught + marked.slice(cut)
}

/** Attach a comment to a new passage. The reader does this. Mate never does it on its own. */
export function anchorComment(markdown: string, id: string, anchor: string, from = 0): string {
  const trimmedAnchor = clean(anchor)
  if (!trimmedAnchor) throw new Error('Select the passage the comment belongs to.')
  const { markers, spans } = strip(markdown)
  const index = indexOfComment(markers, id)
  const without = markdown.slice(0, spans[index].start) + markdown.slice(spans[index].end)
  return place(without, { ...markers[index].value, anchor: trimmedAnchor }, from)
}

/**
 * Give the document a new text, as the reader typed it.
 *
 * A line the reader did not touch keeps its bytes, and the markers under it stay under it. A marker
 * whose line is gone is kept, on a line of its own after what took that line's place. Its comment is
 * then found by its quote, or shown as unanchored. No comment is lost by typing.
 */
export function retype(markdown: string, next: string): string {
  const { markers, text, raw } = strip(markdown)
  const eol = eolOf(markdown)
  const wanted = next.replace(/\r\n/g, '\n')
  // Where each visible line starts in the visible text. The last entry is where the text ends.
  const starts = [0]
  for (const line of text === '' ? [] : text.replace(/\n$/, '').split('\n')) {
    starts.push(Math.min(text.length, starts[starts.length - 1] + line.length + 1))
  }
  // Where a visible line begins in the file. An empty line in a file with Windows line endings begins
  // at its `\r`, which the visible text does not have: without this it would be left with the line before.
  const edge = (visible: number) => {
    const at = raw[visible]
    return markdown[at] === '\n' && markdown[at - 1] === '\r' ? at - 1 : at
  }
  // What comes before the first visible character: markers only, when there is anything.
  let out = markdown.slice(0, edge(0))
  const onNewLine = () => {
    if (out && !out.endsWith('\n')) out += eol
  }
  // Markers of lines that are gone, until the lines that took their place have been written.
  const orphans: string[] = []
  const settle = () => {
    for (const marker of orphans.splice(0)) {
      onNewLine()
      out += marker + eol
    }
  }
  let k = 0
  let typedLast = false
  for (const line of diffLines(text, wanted)) {
    typedLast = line.kind === '+'
    if (line.kind === '+') {
      onNewLine()
      out += line.text + eol
      continue
    }
    // A visible line in the file: its own bytes, its line ending, and the markers that follow it.
    const from = edge(starts[k])
    const to = edge(starts[k + 1])
    k += 1
    if (line.kind === ' ') {
      // Nothing is put between what came before and a line that was kept: the bytes stay as they were.
      settle()
      out += markdown.slice(from, to)
    } else {
      orphans.push(...markers.filter((marker) => marker.start >= from && marker.end <= to).map((marker) => markdown.slice(marker.start, marker.end)))
    }
  }
  const typedEnd = typedLast && orphans.length === 0
  settle()
  // The file ends with a line break when the reader's text does. It does not lose the one it had.
  if (wanted.endsWith('\n') && !text.endsWith('\n')) onNewLine()
  if (!wanted.endsWith('\n') && !text.endsWith('\n') && typedEnd && out.endsWith(eol)) out = out.slice(0, -eol.length)
  return out
}

/**
 * A file that is not markdown keeps its comments beside it, in NAME.comments.md: the markers alone,
 * each naming the line of the file it sits under. A marker in the file itself would break a CSV, a
 * JSON file or a log, and show in every other tool. Put back between the file's lines, the markers
 * read as a draft's do, and every function above works on the two together.
 */
export function combine(body: string, side: string): string {
  const markers = scan(side)
  if (markers.length === 0) return body
  const eol = eolOf(body)
  // The lines of the file, each with its line ending.
  const lines = body.match(/[^\n]*\n|[^\n]+$/g) ?? []
  const under = new Map<number, Stored[]>()
  for (const { value } of markers) {
    // A marker whose line is gone is put after the last line, and its comment is found by its quote.
    const line = Math.min(Math.max(Math.floor(Number(value.line)) || lines.length, 0), lines.length)
    under.set(line, [...(under.get(line) ?? []), value])
  }
  let out = ''
  for (let i = 0; i <= lines.length; i += 1) {
    if (i > 0) out += lines[i - 1]
    for (const value of under.get(i) ?? []) {
      if (out && !out.endsWith('\n')) out += eol
      out += write(value) + eol
    }
  }
  return out
}

/** The file and its side file again, from the two together. Each marker notes the line it sits under. */
export function separate(combined: string, name: string): { body: string; side: string } {
  const { markers, spans } = strip(combined)
  let body = ''
  let from = 0
  const kept: Stored[] = []
  markers.forEach((marker, k) => {
    body += combined.slice(from, spans[k].start)
    from = spans[k].end
    kept.push({ ...marker.value, line: (body.match(/\n/g) ?? []).length + (body && !body.endsWith('\n') ? 1 : 0) })
  })
  body += combined.slice(from)
  const side = [
    `# Comments on ${name}`,
    '',
    `Written by Mate. Each comment quotes a passage of ${name} and names the line it sits under. ${name} itself is not changed by a comment.`,
    '',
    ...kept.map(write),
    ''
  ].join('\n')
  return { body, side }
}

/** The line of the file, from 1, where a place in the text the reader sees sits: the marker lines above it count. */
export function fileLineOf(markdown: string, visible: number): number {
  const { raw } = strip(markdown)
  const at = raw[Math.max(0, Math.min(Math.floor(visible) || 0, raw.length - 1))]
  return (markdown.slice(0, at).match(/\n/g) ?? []).length + 1
}
