import assert from 'node:assert/strict'
import test from 'node:test'
import { fileNamed } from '../src/shared/named.ts'
import { renderMarkdown, type Leaf, type Piece } from '../src/renderer/src/markdown.ts'

function leaves(pieces: Piece[]): Leaf[] {
  return pieces.flatMap((piece) => ('tag' in piece ? leaves(piece.children) : [piece]))
}

function tags(pieces: Piece[]): string[] {
  return pieces.flatMap((piece) => ('tag' in piece ? [piece.tag, ...tags(piece.children)] : []))
}

const draft = `---
title: A draft
---
# Title

Some **bold**, *em*, \`code\`, ~~gone~~, [a link](http://x.y "t"), <http://auto.link> and \\* escape.  
Hard break above. &amp; entity.

> quote line
> second **line**

- item one
  continued
- [ ] task open
- [x] task done
  1. nested

\`\`\`ts
const a = 1
\`\`\`

| a | b |
|---|---|
| 1 | 2 |

Setext
------

***

<!-- a comment -->
<div>html</div>

![alt](img.png)
[ref]: http://ref
`

test('every character of the draft is on the page once, in order', () => {
  for (const text of [draft, '', 'No newline at the end', '```\nnever closed', '\n\n  \n# Late\n\n']) {
    const all = leaves(renderMarkdown(text))
    let at = 0
    for (const leaf of all) {
      assert.equal(leaf.from, at)
      assert.ok(leaf.to > leaf.from)
      at = leaf.to
    }
    assert.equal(at, text.length)
  }
})

test('markup is hidden and the words are not', () => {
  const text = '# Title\n\nSome **bold** [link](http://x.y "A title") text.\n'
  const shown = leaves(renderMarkdown(text))
    .filter((leaf) => !leaf.hidden)
    .map((leaf) => text.slice(leaf.from, leaf.to))
    .join('')
  assert.equal(shown, ' Title\n\nSome bold link text.\n')
  assert.deepEqual(tags(renderMarkdown(text)), ['h1', 'p', 'strong', 'span'])
})

test('front matter and a fenced block are shown as written, without their fences', () => {
  const pieces = renderMarkdown(draft)
  assert.deepEqual(pieces[0], { tag: 'pre', className: 'meta', children: [{ from: 0, to: 23, hidden: false }] })
  const code = pieces.find((piece) => 'tag' in piece && piece.tag === 'pre' && !piece.className)
  assert.ok(code && 'tag' in code)
  const body = leaves(code.children).filter((leaf) => !leaf.hidden)
  assert.deepEqual(body.map((leaf) => draft.slice(leaf.from, leaf.to)), ['const a = 1'])
})

test('a task box and a line to say are found on the page by what they are in the text', () => {
  const pane = '- [ ] Call Ada\n- [x] Sent\n\n[Write this pane again](say:)\n\nA [plain link](http://x.y).\n'
  const elements = (pieces: Piece[]): Extract<Piece, { tag: string }>[] =>
    pieces.flatMap((piece) => ('tag' in piece ? [piece, ...elements(piece.children)] : []))
  const found = elements(renderMarkdown(pane))

  // A box holds its marker, hidden. Where the marker is in the text is how the file is ticked.
  const boxes = found.filter((each) => each.className?.startsWith('box'))
  assert.deepEqual(boxes.map((each) => [each.className, pane.slice((each.children[0] as Leaf).from, (each.children[0] as Leaf).to)]), [['box', '[ ]'], ['box checked', '[x]']])

  // A link whose address is `say:` is the one that becomes a button. Its words are what is shown of it.
  const links = found.filter((each) => each.className === 'link')
  assert.deepEqual(links.map((each) => each.title), ['say:', 'http://x.y'])
  const words = leaves(links[0].children).filter((leaf) => !leaf.hidden).map((leaf) => pane.slice(leaf.from, leaf.to)).join('')
  assert.equal(words, 'Write this pane again')
  // Nothing of the file is dropped for either.
  assert.equal(leaves(renderMarkdown(pane)).map((leaf) => pane.slice(leaf.from, leaf.to)).join(''), pane)
})

test('words in an answer name a file of the project when they name exactly one', () => {
  const files = ['draft/letter.md', 'draft/notes.md', 'dropbox/notes.md', 'intents.md', 'timesheets/2026-10.xlsx']
  // From the project, from the context, with a dot before it, or by the name alone.
  assert.equal(fileNamed('draft/letter.md', 'acme', files), 'draft/letter.md')
  assert.equal(fileNamed('projects/acme/draft/letter.md', 'acme', files), 'draft/letter.md')
  assert.equal(fileNamed(' ./intents.md ', 'acme', files), 'intents.md')
  assert.equal(fileNamed('letter.md', 'acme', files), 'draft/letter.md')
  assert.equal(fileNamed('2026-10.xlsx', 'acme', files), 'timesheets/2026-10.xlsx')
  // A name two files have names neither. Another project's file, a file that is not there, and a path that climbs out name nothing.
  assert.equal(fileNamed('notes.md', 'acme', files), null)
  assert.equal(fileNamed('projects/other/draft/letter.md', 'acme', files), null)
  assert.equal(fileNamed('draft/gone.md', 'acme', files), null)
  assert.equal(fileNamed('../../shelf/terms.md', 'acme', files), null)
  assert.equal(fileNamed('npm install', 'acme', files), null)
})
