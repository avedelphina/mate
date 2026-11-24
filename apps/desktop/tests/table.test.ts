import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { readTable, writeTable } from '../src/main/tables.ts'
import { compareCells, detectDelimiter, parseDelimited, passes, shownRows, toDelimited } from '../src/shared/table.ts'

test('a delimited file is read by the rules of RFC 4180, and written back so that it reads the same', () => {
  const text = 'name;note\r\n"Novak; Jan";"said ""yes""\r\nand left"\r\nPlain;\r\n'
  const rows = parseDelimited(text, ';')
  assert.deepEqual(rows, [['name', 'note'], ['Novak; Jan', 'said "yes"\r\nand left'], ['Plain', '']])
  assert.equal(toDelimited(rows, ';', '\r\n'), text)
  assert.deepEqual(parseDelimited('a,b\n1,2', ','), [['a', 'b'], ['1', '2']], 'no last line break')
  assert.deepEqual(parseDelimited('﻿a,b\n', ','), [['a', 'b']], 'a byte order mark is not part of the first cell')
  assert.deepEqual(parseDelimited('', ','), [])
  assert.equal(toDelimited([['a', 'b,c'], ['"q"', '']], ','), 'a,"b,c"\n"""q""",\n')
})

test('the delimiter is the one the file uses, as Excel in Czech writes semicolons', () => {
  assert.equal(detectDelimiter('a,b,c\n1,2,3\n'), ',')
  assert.equal(detectDelimiter('a;b;c\n1,5;2,5;3\n'), ';')
  assert.equal(detectDelimiter('a\tb\tc\n'), '\t')
  assert.equal(detectDelimiter('"a,b,c";d\n', 'x.csv'), ';', 'a comma in quotes is no delimiter')
  assert.equal(detectDelimiter('a,b\n', 'x.tsv'), '\t')
})

test('a filter keeps the rows with the words, exactly them with =, and without them with !, capitals and accents aside', () => {
  assert.equal(passes('Příliš žluťoučký', 'zlut'), true)
  assert.equal(passes('Citrix', '=citrix'), true)
  assert.equal(passes('Citrix Workspace', '=citrix'), false)
  assert.equal(passes('Citrix Workspace', '!workspace'), false)
  assert.equal(passes('Citrix', '!workspace'), true)
  assert.equal(passes('anything', '  '), true)
})

test('rows are chosen and ordered for showing, the header always first, and numbers are ordered as numbers', () => {
  const rows = [['name', 'size'], ['b', '10'], ['a', '9'], ['c', '100'], ['d', '1,5']]
  assert.deepEqual(shownRows(rows, ['', ''], '', null, 1), [0, 1, 2, 3, 4])
  assert.deepEqual(shownRows(rows, ['', ''], '', { column: 1, down: false }, 1), [0, 4, 2, 1, 3])
  assert.deepEqual(shownRows(rows, ['', ''], '', { column: 1, down: true }, 1), [0, 3, 1, 2, 4])
  assert.deepEqual(shownRows(rows, ['!a', ''], '', null, 1), [0, 1, 3, 4])
  assert.deepEqual(shownRows(rows, ['', ''], '1', null, 1), [0, 1, 3, 4], 'words for any column')
  assert.equal(compareCells('9', '10') < 0, true)
  assert.equal(compareCells('a', 'B') < 0, true)
})

test('a CSV is shown, changed and written back as it was written: its delimiter, line ends and byte order mark', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-table-'))
  try {
    const dir = path.join(root, 'projects/citrix/inputs')
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'licences.csv'), '\uFEFFproduct;seats\r\nCitrix;"1,5"\r\nVMware;10\r\n')
    const view = await readTable(root, 'citrix', 'inputs/licences.csv')
    assert.equal(view.editable, true)
    assert.deepEqual(view.sheets, [{ name: 'licences.csv', rows: [['product', 'seats'], ['Citrix', '1,5'], ['VMware', '10']] }])

    const saved = await writeTable(root, 'citrix', 'inputs/licences.csv', [['product', 'seats'], ['Citrix', '2;5'], ['Zoom', '3']], view.stamp)
    assert.equal(await readFile(path.join(dir, 'licences.csv'), 'utf8'), '\uFEFFproduct;seats\r\nCitrix;"2;5"\r\nZoom;3\r\n')
    assert.deepEqual(saved.sheets[0].rows[1], ['Citrix', '2;5'])

    // A file that is another by the time it is saved is not written over.
    await writeFile(path.join(dir, 'licences.csv'), 'someone,else\n')
    await utimes(path.join(dir, 'licences.csv'), new Date(), new Date(Date.now() + 5000))
    await assert.rejects(writeTable(root, 'citrix', 'inputs/licences.csv', [['x']], saved.stamp), /changed since you opened it/)
    assert.equal(await readFile(path.join(dir, 'licences.csv'), 'utf8'), 'someone,else\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a table that would not be written back as it is, or is not a table, is shown or refused and never changed', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-table-'))
  try {
    const dir = path.join(root, 'projects/citrix/inputs')
    await mkdir(dir, { recursive: true })
    // Windows-1250, as Excel writes it in Czech: shown, and not editable, since it could not go back as it is.
    await writeFile(path.join(dir, 'places.csv'), Buffer.from('M\xecsto;Lid\xe9\nPlze\xf2;170000\n', 'latin1'))
    const places = await readTable(root, 'citrix', 'inputs/places.csv')
    assert.deepEqual(places.sheets[0].rows, [['Město', 'Lidé'], ['Plzeň', '170000']])
    assert.equal(places.editable, false)
    await assert.rejects(writeTable(root, 'citrix', 'inputs/places.csv', [['x']], places.stamp), /not UTF-8/)

    await writeFile(path.join(dir, 'a.tsv'), 'a\tb\n1\t2\n')
    assert.deepEqual((await readTable(root, 'citrix', 'inputs/a.tsv')).sheets[0].rows, [['a', 'b'], ['1', '2']])
    await assert.rejects(readTable(root, 'citrix', 'inputs/notes.md'), /not a table/)
    await assert.rejects(readTable(root, 'citrix', '../x.csv'), /not a table|not in this project/)
    await assert.rejects(readTable(root, 'citrix', 'inputs/missing.csv'), /not in this project/)
    await assert.rejects(writeTable(root, 'citrix', 'inputs/a.tsv', 'not rows', '0:0'), /not a table/)
    await assert.rejects(writeTable(root, 'citrix', 'inputs/a.tsv', [[1]], '0:0'), /not a table/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
