import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
    // The same policy as a scanner gives it: pictures of the pages, with no text in them.
    await copyFile(path.join(import.meta.dirname, 'fixtures/scanned.pdf'), path.join(root, 'projects/a/dropbox/scanned.pdf'))

    const left: number[] = []
    assert.equal(await refreshTwins(root, HELPER, (count) => left.push(count)), 4)
    assert.deepEqual(left, [4, 3, 2, 1, 0])
    // A scanned page is read off its picture.
    assert.match(await readFile(path.join(root, '.indexes/text/projects/a/dropbox/scanned.pdf.txt'), 'utf8'), /Každý dokument musí mít stupeň důvěrnosti/)
    const twin = (relative: string) => readFile(path.join(root, '.indexes/text', `${relative}.txt`), 'utf8')
    assert.match(await twin('shelf/classification.pdf'), /Každý dokument musí mít stupeň důvěrnosti/)
    assert.match(await twin('projects/a/draft/report.docx'), /archived for twelve months/)
    // What cannot be read has an empty text, so it is not tried again until it changes.
    assert.equal(await twin('projects/a/dropbox/broken.pdf'), '')
    assert.equal(await refreshTwins(root, HELPER), 0)
    // Twins made by another version of Mate are all made again, once.
    await writeFile(path.join(root, '.indexes/text/.version'), '1')
    assert.equal(await refreshTwins(root, HELPER), 4)
    assert.equal(await refreshTwins(root, HELPER), 0)

    // Search finds the words, by the file they are in, and says what kind of file that is.
    const index = await refreshIndex(root)
    // The shelf comes first. The scan says the same, and is found by its words too.
    assert.deepEqual([...new Set(searchIndex(index, 'důvěrnosti').map((hit) => `${hit.kind} ${hit.path}`))], [
      'shelf shelf/classification.pdf',
      'material projects/a/dropbox/scanned.pdf'
    ])
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
    assert.deepEqual([...new Set(searchIndex(await refreshIndex(root), 'důvěrnosti').map((hit) => hit.path))], ['projects/a/dropbox/scanned.pdf'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

const available = (command: string): boolean => {
  try {
    execFileSync(command, [command === 'pdftotext' ? '-v' : '--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

test('Linux reads a PDF, a Word file and a web archive with external tools', { skip: process.platform !== 'linux' || !available('pdftotext') || !available('libreoffice') || !available('python3') }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-linux-twins-'))
  // The converter's input and profile stay outside the context, or search finds them too.
  const outside = await mkdtemp(path.join(tmpdir(), 'mate-linux-source-'))
  try {
    await mkdir(path.join(root, 'shelf'))
    await mkdir(path.join(root, 'projects/a/draft'), { recursive: true })
    await copyFile(path.join(import.meta.dirname, 'fixtures/classification.pdf'), path.join(root, 'shelf/classification.pdf'))
    await writeFile(path.join(outside, 'report.txt'), 'Draft reports are archived for eighteen months.\n')
    execFileSync(
      'libreoffice',
      [
        '--headless',
        '--nologo',
        '--nodefault',
        '--nofirststartwizard',
        '--nolockcheck',
        '--norestore',
        `-env:UserInstallation=${new URL(`file://${path.join(outside, 'libreoffice-profile')}`).href}`,
        '--convert-to',
        'docx',
        '--outdir',
        path.join(root, 'projects/a/draft'),
        path.join(outside, 'report.txt')
      ],
      { stdio: 'ignore' }
    )
    execFileSync(
      'python3',
      [
        '-c',
        "import plistlib,sys; f=open(sys.argv[1],'wb'); plistlib.dump({'WebMainResource':{'WebResourceData':b'<html><body><h1>Archive policy</h1><script>hidden script</script><p>Retain every record.</p></body></html>'}},f); f.close()",
        path.join(root, 'projects/a/draft/policy.webarchive')
      ]
    )

    assert.equal(await refreshTwins(root, '/no/helper'), 3)
    const twin = (relative: string) => readFile(path.join(root, '.indexes/text', `${relative}.txt`), 'utf8')
    assert.match(await twin('shelf/classification.pdf'), /Směrnice o klasifikaci/)
    assert.match(await twin('projects/a/draft/report.docx'), /archived for eighteen months/)
    assert.match(await twin('projects/a/draft/policy.webarchive'), /Archive policy[\s\S]*Retain every record/)
    assert.doesNotMatch(await twin('projects/a/draft/policy.webarchive'), /hidden script/)
    assert.deepEqual(searchIndex(await refreshIndex(root), 'archived').map((hit) => hit.path), ['projects/a/draft/report.docx'])
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test('Linux OCR waits for Tesseract and reads the rendered pages in order', { skip: process.platform !== 'linux' }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-linux-ocr-'))
  const pathWas = process.env.PATH
  try {
    const bin = path.join(root, 'bin')
    await mkdir(bin)
    await mkdir(path.join(root, 'projects/a/dropbox'), { recursive: true })
    await copyFile(path.join(import.meta.dirname, 'fixtures/scanned.pdf'), path.join(root, 'projects/a/dropbox/scanned.pdf'))
    const command = async (name: string, text: string) => {
      await writeFile(path.join(bin, name), text)
      await chmod(path.join(bin, name), 0o755)
    }
    await command('pdftotext', '#!/bin/sh\nexit 0\n')
    await command('pdftoppm', '#!/bin/sh\nfor last; do :; done\nprintf first > "$last-1.jpg"\nprintf second > "$last-2.jpg"\n')
    process.env.PATH = bin

    assert.equal(await refreshTwins(root, '/no/helper'), 0)
    assert.equal(existsSync(path.join(root, '.indexes/text/projects/a/dropbox/scanned.pdf.txt')), false)
    await command('tesseract', "#!/bin/sh\nif [ \"$1\" = \"--list-langs\" ]; then printf 'eng\\n'; exit 0; fi\n")
    assert.equal(await refreshTwins(root, '/no/helper'), 0)
    assert.equal(existsSync(path.join(root, '.indexes/text/projects/a/dropbox/scanned.pdf.txt')), false)
    await command(
      'tesseract',
      "#!/bin/sh\nif [ \"$1\" = \"--list-langs\" ]; then printf 'eng\\nces\\n'; exit 0; fi\ncase \"$1\" in *page-1.jpg) echo 'First scanned page.' ;; *) echo 'Second scanned page.' ;; esac\n"
    )
    assert.equal(await refreshTwins(root, '/no/helper'), 1)
    const text = await readFile(path.join(root, '.indexes/text/projects/a/dropbox/scanned.pdf.txt'), 'utf8')
    assert.ok(text.indexOf('First scanned page.') < text.indexOf('Second scanned page.'))
  } finally {
    process.env.PATH = pathWas
    await rm(root, { recursive: true, force: true })
  }
})

test('Linux reads a real scanned PDF with Tesseract', { skip: process.platform !== 'linux' || !available('pdftotext') || !available('pdftoppm') || !available('tesseract') }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-linux-real-ocr-'))
  try {
    await mkdir(path.join(root, 'projects/a/dropbox'), { recursive: true })
    await copyFile(path.join(import.meta.dirname, 'fixtures/scanned.pdf'), path.join(root, 'projects/a/dropbox/scanned.pdf'))
    assert.equal(await refreshTwins(root, '/no/helper'), 1)
    assert.match(await readFile(path.join(root, '.indexes/text/projects/a/dropbox/scanned.pdf.txt'), 'utf8'), /Každý dokument/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a workbook is read sheet by sheet as tables, and a CSV as its text, in the encoding it was written in', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-tables-'))
  try {
    const book = path.join(root, 'book')
    await mkdir(path.join(book, 'xl/_rels'), { recursive: true })
    await mkdir(path.join(book, 'xl/worksheets'))
    // The second sheet in the file is the first in the workbook: the order is the workbook's.
    await writeFile(
      path.join(book, 'xl/workbook.xml'),
      '<workbook><sheets><sheet name="Rozpočet &amp; plán" sheetId="2" r:id="rId2"/><sheet name="Empty" sheetId="1" r:id="rId1"/></sheets></workbook>'
    )
    await writeFile(
      path.join(book, 'xl/_rels/workbook.xml.rels'),
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Target="/xl/worksheets/sheet2.xml" Id="rId2"/></Relationships>'
    )
    await writeFile(path.join(book, 'xl/sharedStrings.xml'), '<sst><si><t>Položka</t></si><si><r><t>Cena</t></r><r><t xml:space="preserve"> v Kč</t></r></si><si><t>Licence a|b</t></si></sst>')
    await writeFile(path.join(book, 'xl/worksheets/sheet1.xml'), '<worksheet><sheetData/></worksheet>')
    await writeFile(
      path.join(book, 'xl/worksheets/sheet2.xml'),
      '<worksheet><sheetData>' +
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="D1" t="s"><v>1</v></c></row>' +
        '<row r="2"/>' +
        '<row r="3"><c r="A3" t="s"><v>2</v></c><c r="B3" s="1"/><c r="D3"><f>SUM(X1:X9)</f><v>1200.5</v></c></row>' +
        '<row r="4"><c r="A4" t="inlineStr"><is><t>Server\nnový</t></is></c><c r="D4" t="b"><v>1</v></c></row>' +
        '</sheetData></worksheet>'
    )
    await mkdir(path.join(root, 'projects/a/tables'), { recursive: true })
    execFileSync('/usr/bin/zip', ['-qr', path.join(root, 'projects/a/tables/budget.xlsx'), 'xl'], { cwd: book })
    await rm(book, { recursive: true })
    // As Excel on a Czech system writes a CSV: Windows-1250, with semicolons. ě, é and ň are one byte each.
    await writeFile(path.join(root, 'projects/a/tables/places.csv'), Buffer.from('M\xecsto;Lid\xe9\nPlze\xf2;170000\n', 'latin1'))

    assert.equal(await refreshTwins(root, '/no/helper'), 2)
    // Columns empty all the way down are left out, and a row with nothing in it.
    assert.equal(
      await readFile(path.join(root, '.indexes/text/projects/a/tables/budget.xlsx.txt'), 'utf8'),
      '## Rozpočet & plán\n\n| Položka | Cena v Kč |\n| --- | --- |\n| Licence a\\|b | 1200.5 |\n| Server nový | TRUE |\n'
    )
    assert.equal(await readFile(path.join(root, '.indexes/text/projects/a/tables/places.csv.txt'), 'utf8'), 'Město;Lidé\nPlzeň;170000\n')
    const found = async (query: string) => searchIndex(await refreshIndex(root), query).map((hit) => hit.path)
    assert.deepEqual(await found('Licence'), ['projects/a/tables/budget.xlsx'])
    assert.deepEqual(await found('Plzeň'), ['projects/a/tables/places.csv'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
