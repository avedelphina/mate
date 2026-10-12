export type ReviewComment = {
  id: string
  anchor: string
  text: string
  author: string
}

const OPEN = '<!-- @comment'
const CLOSE = '-->'

/** Markers md-redline can read. Malformed JSON is ignored. */
export function parseComments(markdown: string): ReviewComment[] {
  const comments: ReviewComment[] = []
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
        const value = JSON.parse(markdown.slice(bodyStart, end).trim()) as Partial<ReviewComment>
        if (typeof value.anchor === 'string' && typeof value.text === 'string') {
          comments.push({
            id: String(value.id ?? ''),
            anchor: value.anchor,
            text: value.text,
            author: String(value.author ?? '')
          })
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
  return comments
}

/**
 * Insert one comment on the line after its anchor.
 * The anchor must occur on a single line that is not itself a marker.
 */
export function insertComment(markdown: string, anchor: string, text: string, author: string): string {
  const trimmedAnchor = anchor.trim()
  const trimmedText = text.trim()
  const trimmedAuthor = author.trim() || 'you'
  if (!trimmedAnchor) throw new Error('Select the sentence the comment is about.')
  if (trimmedAnchor.includes('\n')) throw new Error('Select text on a single line.')
  if (!trimmedText) throw new Error('The comment is empty.')

  const lines = markdown.split('\n')
  const index = lines.findIndex((line) => !line.includes('@comment') && line.includes(trimmedAnchor))
  if (index < 0) throw new Error('That text is not on a single line of this document.')

  let insertAt = index + 1
  while (insertAt < lines.length && lines[insertAt].includes('@comment')) insertAt += 1

  const used = parseComments(markdown)
    .map((comment) => Number(comment.id))
    .filter((id) => Number.isInteger(id))
  const id = String((used.length > 0 ? Math.max(...used) : 0) + 1)
  const marker = OPEN + JSON.stringify({
    id,
    anchor: trimmedAnchor,
    text: trimmedText,
    author: trimmedAuthor
  }) + ' ' + CLOSE
  lines.splice(insertAt, 0, marker)
  return lines.join('\n')
}
