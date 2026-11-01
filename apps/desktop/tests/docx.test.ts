import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'
import test from 'node:test'
import { docxToMarkdown, reflow } from '../src/main/docx.ts'

/** A zip of the given parts, as Word makes one: a local header and its data for each, then the central directory. */
function zip(parts: Record<string, string>, stored = false): Buffer {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, text] of Object.entries(parts)) {
    const raw = Buffer.from(text)
    const data = stored ? raw : deflateRawSync(raw)
    const label = Buffer.from(name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(stored ? 0 : 8, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(label.length, 26)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(stored ? 0 : 8, 10)
    entry.writeUInt32LE(data.length, 20)
    entry.writeUInt32LE(raw.length, 24)
    entry.writeUInt16LE(label.length, 28)
    entry.writeUInt32LE(offset, 42)
    locals.push(local, label, data)
    central.push(entry, label)
    offset += 30 + label.length + data.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(parts).length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const p = (properties: string, ...runs: string[]) => `<w:p><w:pPr>${properties}</w:pPr>${runs.join('')}</w:p>`
const r = (text: string, properties = '') => `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`

const styles = `<w:styles ${W}>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
  <w:style w:type="paragraph" w:styleId="Nadpis2"><w:name w:val="heading 2"/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>
  <w:style w:type="paragraph" w:styleId="Bullets"><w:name w:val="List Bullet"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>
</w:styles>`
const numbering = `<w:numbering ${W}>
  <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
  <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`
const rels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="x" Target="https://example.com/a b" TargetMode="External"/></Relationships>`
const document = `<?xml version="1.0"?><w:document ${W}><w:body>
  ${p('<w:pStyle w:val="Title"/>', r('Plan'))}
  ${p('<w:pStyle w:val="Heading1"/>', r('Scope'))}
  ${p('', r('Plain, '), r('bold', '<w:b/>'), r(' and '), r('italic', '<w:i/>'), r(' &amp; more &lt;ok&gt;.'))}
  ${p('', r('Off ', '<w:b w:val="0"/>'), r('see '), `<w:hyperlink r:id="rId9">${r('the site')}</w:hyperlink>`)}
  ${p('<w:pStyle w:val="Nadpis2"/>', r('Steps'))}
  ${p('<w:pStyle w:val="Bullets"/>', r('first'))}
  ${p('<w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr>', r('nested'))}
  ${p('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>', r('one'))}
  ${p('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>', r('two'))}
  ${p('<w:outlineLvl w:val="2"/>', r('By outline'))}
  ${p('')}
  ${p('', r('- not a list'))}
  <w:tbl>
    <w:tr><w:tc><w:p>${r('Name')}</w:p></w:tc><w:tc><w:p>${r('Port')}</w:p></w:tc></w:tr>
    <w:tr><w:tc><w:p>${r('WinRM | HTTPS')}</w:p></w:tc><w:tc><w:p>${r('5986')}</w:p></w:tc></w:tr>
    <w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p>${r('wide')}</w:p></w:tc></w:tr>
  </w:tbl>
</w:body></w:document>`

const expected = [
  '# Plan',
  '',
  '# Scope',
  '',
  'Plain, **bold** and *italic* & more <ok>.',
  '',
  'Off see [the site](https://example.com/a%20b)',
  '',
  '## Steps',
  '',
  '- first',
  '    - nested',
  '',
  '1. one',
  '1. two',
  '',
  '### By outline',
  '',
  '\\- not a list',
  '',
  '| Name | Port |',
  '| --- | --- |',
  '| WinRM \\| HTTPS | 5986 |',
  '| wide |  |',
  ''
].join('\n')

test('a Word file becomes markdown with its headings, lists, table, bold and links', () => {
  const file = zip({ 'word/document.xml': document, 'word/styles.xml': styles, 'word/numbering.xml': numbering, 'word/_rels/document.xml.rels': rels })
  assert.equal(docxToMarkdown(file), expected)
  // Stored, and not compressed: the same.
  assert.equal(docxToMarkdown(zip({ 'word/document.xml': document, 'word/styles.xml': styles, 'word/numbering.xml': numbering, 'word/_rels/document.xml.rels': rels }, true)), expected)
})

test('a file that is not a Word file, or is damaged, or is too large, is refused and nothing in it is run', () => {
  assert.throws(() => docxToMarkdown(Buffer.from('not a zip at all, but long enough to be looked at')), /not a zip/)
  assert.throws(() => docxToMarkdown(zip({ 'word/other.xml': '<a/>' })), /no text part/)
  const big = zip({ 'word/document.xml': 'x'.repeat(100) })
  // A part that says it unpacks to more than the ceiling is not unpacked.
  big.writeUInt32LE(0x7fffffff, big.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 24)
  assert.throws(() => docxToMarkdown(big), /too large/)
  // A link to a script is not made a link.
  const bad = zip({ 'word/document.xml': `<w:document ${W}><w:body>${p('', `<w:hyperlink r:id="rId1">${r('click')}</w:hyperlink>`)}</w:body></w:document>`, 'word/_rels/document.xml.rels': `<Relationships><Relationship Id="rId1" Target="javascript:alert(1)" TargetMode="External"/></Relationships>` })
  assert.equal(docxToMarkdown(bad), 'click\n')
})

test('the lines of a PDF are joined into paragraphs, and a split word is whole again', () => {
  assert.equal(
    reflow('Collector listens on\nport 5986 and the sub-\nscription is kept.\n\nSecond paragraph\nhere.\n\n- first item\n- second item\n'),
    'Collector listens on port 5986 and the subscription is kept.\n\nSecond paragraph here.\n\n- first item\n- second item\n'
  )
  assert.equal(reflow('One\r\ntwo\r\n'), 'One two\n')
})
