import { randomUUID } from 'node:crypto'
import { readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { detectDelimiter, parseDelimited, toDelimited } from '../shared/table'
import { realInside } from './context'
import { mateWrote } from './guard'
import { readWorkbook, type Sheet } from './twins'

/**
 * A table of a project as the table view takes it: rows of text in one or more sheets. A CSV or TSV can be changed and
 * written back, with the delimiter, the line ends and the byte order mark it had. A workbook is read only. Every row is
 * text, and what the view does with them (a filter, a sort) is its own and never reaches the file.
 */
export type TableView = {
  name: string
  kind: 'csv' | 'tsv' | 'xlsx'
  sheets: Sheet[]
  editable: boolean
  /** Why it cannot be changed here, when it cannot. */
  why?: string
  /** What the file was when read. A write is refused when the file is another by then. */
  stamp: string
}

// ponytail: a table is read whole into the window. Past these a file wants a view that reads part of it.
const MAX_TEXT = 20 * 1024 * 1024
const MAX_BOOK = 100 * 1024 * 1024
const KINDS = new Map<string, TableView['kind']>([['.csv', 'csv'], ['.tsv', 'tsv'], ['.xlsx', 'xlsx']])

async function placed(contextDir: string, project: string, relative: string): Promise<{ full: string; kind: TableView['kind']; name: string }> {
  const parts = String(relative).split('/')
  const name = parts[parts.length - 1] ?? ''
  const kind = KINDS.get(path.extname(name).toLowerCase())
  if (!kind || parts.some((part) => part === '' || part.startsWith('.'))) throw new Error('That is not a table Mate can show: a CSV, a TSV or an Excel workbook of this project.')
  return { full: await realInside(contextDir, 'projects', project, ...parts).catch(() => { throw new Error('That file is not in this project.') }), kind, name }
}

const stampOf = (info: { mtimeMs: number; size: number }) => `${info.mtimeMs}:${info.size}`

/** The text of a delimited file when it is UTF-8, which is what it can be written back in. Null otherwise. */
function utf8(bytes: Buffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

export async function readTable(contextDir: string, project: string, relative: string): Promise<TableView> {
  const { full, kind, name } = await placed(contextDir, String(project), relative)
  const info = await stat(full)
  if (!info.isFile()) throw new Error('That is not a file.')
  if (info.size > (kind === 'xlsx' ? MAX_BOOK : MAX_TEXT)) throw new Error('That table is too large to show here.')
  if (kind === 'xlsx') {
    const sheets = await readWorkbook(full)
    if (sheets.length === 0) throw new Error('That workbook has no cells to show.')
    return { name, kind, sheets, editable: false, why: 'A workbook is shown, not changed. Take its text out to work on it.', stamp: stampOf(info) }
  }
  const bytes = await readFile(full)
  const text = utf8(bytes)
  const shown = text ?? new TextDecoder('windows-1250').decode(bytes)
  const rows = parseDelimited(shown, kind === 'tsv' ? '\t' : detectDelimiter(shown, name))
  return {
    name,
    kind,
    sheets: [{ name, rows }],
    editable: text !== null,
    ...(text === null ? { why: 'Its text is not UTF-8, so it would not be written back as it is. It is shown, not changed.' } : {}),
    stamp: stampOf(info)
  }
}

/**
 * Write rows back into a CSV or a TSV, the way the file was written: its delimiter, its line ends and its byte order mark. A file
 * that changed since it was read is not written over. By a temporary file and a rename, so the file is whole or as it was.
 */
export async function writeTable(contextDir: string, project: string, relative: string, rows: unknown, stamp: string): Promise<TableView> {
  const { full, kind } = await placed(contextDir, String(project), relative)
  if (kind === 'xlsx') throw new Error('A workbook is not changed here.')
  if (!Array.isArray(rows) || rows.some((row) => !Array.isArray(row) || row.some((cell) => typeof cell !== 'string'))) throw new Error('That is not a table.')
  const info = await stat(full)
  if (stampOf(info) !== stamp) throw new Error('The file has changed since you opened it. Nothing was saved. Open it again.')
  const bytes = await readFile(full)
  const text = utf8(bytes)
  if (text === null) throw new Error('That file is not UTF-8, so it is not written back here.')
  const delimiter = kind === 'tsv' ? '\t' : detectDelimiter(text, path.basename(full))
  const next = (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? '﻿' : '') + toDelimited(rows as string[][], delimiter, text.includes('\r\n') ? '\r\n' : '\n')
  if (Buffer.byteLength(next) > MAX_TEXT) throw new Error('That table is too large to save here.')
  const temporary = path.join(path.dirname(full), `.${path.basename(full)}.${randomUUID()}.tmp`)
  await writeFile(temporary, next)
  await rename(temporary, full)
  mateWrote(contextDir, path.relative(contextDir, full).split(path.sep).join('/'), Buffer.from(next))
  return readTable(contextDir, project, relative)
}
