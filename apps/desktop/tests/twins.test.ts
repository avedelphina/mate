import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { listShelf, readContextFile } from '../src/main/context.ts'
import { refreshIndex, searchIndex } from '../src/main/contextIndex.ts'
import { refreshTwins } from '../src/main/twins.ts'

// The helper reads a PDF. `pnpm build:assist` makes it, on a Mac.
const HELPER = path.resolve(import.meta.dirname, '../assist/mate-assist')

test('a PDF and a Word file are read as text, found by search, and read in place of the file', { skip: process.platform !== 'darwin' || !existsSync(HELPER) }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-twins-'))
  try {
    await mkdir(path.join(root, 'shelf'))
    await mkdir(path.join(root, 'projects/a/draft'), { recursive: true })
    await mkdir(path.join(root, 'projects/a/dropbox'), { recursive: true })
    // A policy as an office prints it, a draft as Word writes it, and a file that only says it is a PDF.
    await copyFile(path.join(import.meta.dirname, 'fixtures/classification.pdf'), path.join(root, 'shelf/classification.pdf'))
    const word = async (text: string) => {
      await writeFile(path.join(root, 'report.txt'), text)
      execFileSync('/usr/bin/textutil', ['-convert', 'docx', '-output', path.join(root, 'projects/a/draft/report.docx'), path.join(root, 'report.txt')])
      await rm(path.join(root, 'report.txt'))
    }
    await word('Draft reports are archived for twelve months.\n')
    await writeFile(path.join(root, 'projects/a/dropbox/broken.pdf'), 'not a pdf')

    const left: number[] = []
    assert.equal(await refreshTwins(root, HELPER, (count) => left.push(count)), 3)
    assert.deepEqual(left, [3, 2, 1, 0])
    const twin = (relative: string) => readFile(path.join(root, '.indexes/text', `${relative}.txt`), 'utf8')
    assert.match(await twin('shelf/classification.pdf'), /Každý dokument musí mít stupeň důvěrnosti/)
    assert.match(await twin('projects/a/draft/report.docx'), /archived for twelve months/)
    // What cannot be read has an empty text, so it is not tried again until it changes.
    assert.equal(await twin('projects/a/dropbox/broken.pdf'), '')
    assert.equal(await refreshTwins(root, HELPER), 0)

    // Search finds the words, by the file they are in, and says what kind of file that is.
    const index = await refreshIndex(root)
    assert.deepEqual([...new Set(searchIndex(index, 'důvěrnosti').map((hit) => `${hit.kind} ${hit.path}`))], ['shelf shelf/classification.pdf'])
    assert.deepEqual([...new Set(searchIndex(index, 'archived').map((hit) => `${hit.kind} ${hit.path}`))], ['draft projects/a/draft/report.docx'])

    // The window and agents read the text in place of the file. The twin itself is not a document.
    const read = await readContextFile(root, 'shelf/classification.pdf')
    assert.equal(read.twin, true)
    assert.equal(read.kind, 'shelf')
    assert.match(read.text, /Records classified as confidential/)
    await assert.rejects(readContextFile(root, '.indexes/text/shelf/classification.pdf.txt'), /not a document/)
    assert.deepEqual(await listShelf(root), ['classification.pdf'])

    // A file that changes is read again. One that goes takes its text with it, and search forgets it.
    await word('Draft reports are archived for eighteen months.\n')
    assert.equal(await refreshTwins(root, HELPER), 1)
    assert.match(await twin('projects/a/draft/report.docx'), /eighteen months/)
    await rm(path.join(root, 'shelf/classification.pdf'))
    assert.equal(await refreshTwins(root, HELPER), 1)
    assert.equal(existsSync(path.join(root, '.indexes/text/shelf/classification.pdf.txt')), false)
    assert.deepEqual(searchIndex(await refreshIndex(root), 'důvěrnosti'), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
