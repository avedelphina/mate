/**
 * Tables as rows of text: a delimited file (CSV, TSV) read and written back, and what the table view does with
 * rows, which is only to choose which to show. Nothing here changes a row: a filter and a sort hide and order.
 */

/** The mark a delimited file uses: the one most often outside quotes on its first lines. A tab file is a tab file. */
export function detectDelimiter(text: string, name = ''): string {
  if (/\.tsv$/i.test(name)) return '\t'
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).slice(0, 5)
  const count = (mark: string) => lines.reduce((sum, line) => sum + (line.replace(/"[^"]*"/g, '').split(mark).length - 1), 0)
  const [comma, semicolon, tab] = [count(','), count(';'), count('\t')]
  if (tab > comma && tab > semicolon) return '\t'
  return semicolon > comma ? ';' : ','
}

/** Rows of cells, by RFC 4180: a cell in quotes may hold the delimiter, a line break, and `""` for a quote. A blank last line is no row. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const body = text.replace(/^﻿/, '')
  for (let at = 0; at < body.length; at++) {
    const mark = body[at]
    if (quoted) {
      if (mark === '"' && body[at + 1] === '"') (cell += '"', at++)
      else if (mark === '"') quoted = false
      else cell += mark
    } else if (mark === '"' && cell === '') quoted = true
    else if (mark === delimiter) (row.push(cell), (cell = ''))
    else if (mark === '\n' || mark === '\r') {
      if (mark === '\r' && body[at + 1] === '\n') at++
      row.push(cell)
      rows.push(row)
      ;[row, cell] = [[], '']
    } else cell += mark
  }
  if (cell !== '' || row.length > 0) (row.push(cell), rows.push(row))
  return rows
}

/** Rows as a delimited file: a cell is quoted when it holds the delimiter, a quote or a line break, and nowhere else. */
export function toDelimited(rows: string[][], delimiter: string, eol = '\n'): string {
  const cell = (value: string) => (value.includes(delimiter) || /["\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value)
  return rows.map((row) => row.map(cell).join(delimiter)).join(eol) + (rows.length > 0 ? eol : '')
}

/**
 * Whether a cell passes the words typed under its column. `=words` is exactly those words, `!words` is not holding them, and
 * anything else is holding them. Capitals and accents do not matter, and no words let everything through.
 */
export function passes(cell: string, wanted: string): boolean {
  const fold = (text: string) => text.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase()
  const text = wanted.trim()
  if (text === '') return true
  const have = fold(cell)
  if (text.startsWith('=')) return have === fold(text.slice(1).trim())
  if (text.startsWith('!')) return !have.includes(fold(text.slice(1).trim()))
  return have.includes(fold(text))
}

/** The numbers a column holds are put in order as numbers, and anything else as words, capitals and accents aside. */
export function compareCells(a: string, b: string): number {
  const [x, y] = [Number(a.replace(/\s/g, '').replace(',', '.')), Number(b.replace(/\s/g, '').replace(',', '.'))]
  if (a.trim() !== '' && b.trim() !== '' && Number.isFinite(x) && Number.isFinite(y)) return x - y
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
}

/**
 * The rows to show, as their places in `rows`: those that pass every column's words and the words for any column,
 * in the order of a column when one is chosen. `skip` rows at the top (the header) are always first and always shown.
 */
export function shownRows(rows: string[][], filters: string[], anywhere: string, sort: { column: number; down: boolean } | null, skip = 0): number[] {
  const body = rows.map((row, at) => ({ row, at })).slice(skip)
  const kept = body.filter(({ row }) => filters.every((wanted, column) => passes(row[column] ?? '', wanted)) && (anywhere.trim() === '' || row.some((cell) => passes(cell, anywhere))))
  if (sort) kept.sort((a, b) => (sort.down ? -1 : 1) * compareCells(a.row[sort.column] ?? '', b.row[sort.column] ?? ''))
  return [...rows.slice(0, skip).map((_, at) => at), ...kept.map((each) => each.at)]
}
