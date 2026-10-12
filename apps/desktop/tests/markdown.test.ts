import assert from 'node:assert/strict'
import test from 'node:test'
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
