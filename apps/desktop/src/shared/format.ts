/** What the toolbar over the editor can do to the text of a file. */
export type Format = 'bold' | 'italic' | 'code' | 'link' | 'heading' | 'quote' | 'bullet' | 'number' | 'task'

/** One edit of the field: replace `from`..`to` with `insert`, then select `select`. */
export type Edit = { from: number; to: number; insert: string; select: [number, number] }

const MARKS: Partial<Record<Format, string>> = { bold: '**', italic: '_', code: '`' }

/**
 * The edit a button makes, given the text and the selection. Pressed again on the same words it
 * takes the markup off. Only a replacement of a range is returned, so the field can apply it as
 * typing and keep its undo.
 */
export function format(text: string, start: number, end: number, kind: Format): Edit {
  const mark = MARKS[kind]
  if (mark) return wrap(text, start, end, mark, mark)
  if (kind === 'link') {
    const words = text.slice(start, end)
    const insert = `[${words}](url)`
    const at = start + words.length + 3
    return { from: start, to: end, insert, select: [at, at + 3] }
  }
  return lines(text, start, end, kind)
}

function wrap(text: string, start: number, end: number, open: string, close: string): Edit {
  const words = text.slice(start, end)
  // The marks are just outside the selection: take them off.
  if (text.slice(start - open.length, start) === open && text.slice(end, end + close.length) === close) {
    return { from: start - open.length, to: end + close.length, insert: words, select: [start - open.length, end - open.length] }
  }
  // The marks are inside it.
  if (words.length >= open.length + close.length && words.startsWith(open) && words.endsWith(close)) {
    const bare = words.slice(open.length, words.length - close.length)
    return { from: start, to: end, insert: bare, select: [start, start + bare.length] }
  }
  return { from: start, to: end, insert: open + words + close, select: [start + open.length, start + open.length + words.length] }
}

const HEADING = /^(#{1,6}) /
const LIST = /^(?:- \[[ xX]\] |- |\d+\. |> )/

function lines(text: string, start: number, end: number, kind: Format): Edit {
  const from = text.lastIndexOf('\n', start - 1) + 1
  // A selection that ends at the start of a line does not take that line.
  const stop = end > start && text[end - 1] === '\n' ? end - 1 : end
  const next = text.indexOf('\n', stop)
  const to = next === -1 ? text.length : next
  const rows = text.slice(from, to).split('\n')
  const prefix = (row: string, index: number): string => {
    if (kind === 'heading') {
      const level = HEADING.exec(row)?.[1].length ?? 0
      return level === 0 ? '# ' : level < 3 ? '#'.repeat(level + 1) + ' ' : ''
    }
    return kind === 'quote' ? '> ' : kind === 'bullet' ? '- ' : kind === 'task' ? '- [ ] ' : `${index + 1}. `
  }
  const same = (row: string): boolean =>
    kind === 'quote' ? row.startsWith('> ')
    : kind === 'bullet' ? row.startsWith('- ') && !row.startsWith('- [')
    : kind === 'task' ? /^- \[[ xX]\] /.test(row)
    : kind === 'number' ? /^\d+\. /.test(row)
    : false
  const strip = (row: string): string => row.replace(kind === 'heading' ? HEADING : LIST, '')
  const off = kind !== 'heading' && rows.every((row) => !row.trim() || same(row))
  const insert = rows
    .map((row, index) => {
      if (!row.trim() && rows.length > 1) return row
      if (off) return strip(row)
      return prefix(row, index) + strip(row)
    })
    .join('\n')
  return { from, to, insert, select: [from, from + insert.length] }
}
