import assert from 'node:assert/strict'
import test from 'node:test'
import { linkedFrom, type Index } from '../src/main/contextIndex.ts'
import { nameFor, relink, resolveWiki, wikiLinks } from '../src/shared/wiki.ts'

test('a link written as code is text about links, not a link', () => {
  const text = 'Write `[[name]]` for a link. [[real]] is one.\n\n```\n[[in a block]]\n```\n\n~~~md\n[[also code]]\n~~~\n\nAnd [[last]].'
  assert.deepEqual(wikiLinks(text).map((link) => link.target), ['real', 'last'])
})

test('a link is read with its heading and its shown words, and an embed is no link', () => {
  const text = 'See [[a]], [[b#Part|the part]] and ![[picture.png]] but not [[ ]] or [single].'
  assert.deepEqual(
    wikiLinks(text).map((link) => [text.slice(link.start, link.end), link.target, link.heading, link.alias]),
    [['[[a]]', 'a', '', ''], ['[[b#Part|the part]]', 'b', 'Part', 'the part']]
  )
})

const PATHS = ['shelf/Policy.md', 'shelf/terms.md', 'projects/a/draft/terms.md', 'projects/a/draft/notes.md', 'projects/b/draft/notes.md', 'projects/a/material/report.pdf', 'projects/a/draft/sub/deep.md']

test('a name means the file of that name: its own project first, then the shelf, and never a guess', () => {
  assert.equal(resolveWiki('terms', 'a', PATHS), 'projects/a/draft/terms.md')
  assert.equal(resolveWiki('terms', 'b', PATHS), 'shelf/terms.md')
  assert.equal(resolveWiki('policy', 'a', PATHS), 'shelf/Policy.md')
  assert.equal(resolveWiki('Policy.md', 'a', PATHS), 'shelf/Policy.md')
  assert.equal(resolveWiki('sub/deep', 'a', PATHS), 'projects/a/draft/sub/deep.md')
  assert.equal(resolveWiki('report.pdf', 'a', PATHS), 'projects/a/material/report.pdf')
  assert.equal(resolveWiki('report', 'a', PATHS), null, 'no extension is a note, and there is none')
  assert.equal(resolveWiki('notes', null, PATHS), null, 'two notes of one name, in no project: no answer')
  assert.equal(resolveWiki('missing', 'a', PATHS), null)
  assert.equal(resolveWiki('  ', 'a', PATHS), null)
})

test('what links to a file is found among the documents that name it', () => {
  const entry = (path: string, text: string, project: string | null) => ({ path, title: path, text, project, kind: 'draft', mtime: 0, size: 0, comments: [], tags: [] })
  const index = {
    version: 5,
    files: [
      entry('shelf/terms.md', 'Terms.', null),
      entry('projects/a/draft/terms.md', 'Terms of a.', 'a'),
      entry('projects/a/draft/one.md', 'Uses [[terms]].', 'a'),
      entry('projects/b/draft/two.md', 'Uses [[terms]] and [[terms|them]].', 'b'),
      entry('projects/b/draft/three.md', 'Names [[nothing]].', 'b'),
      entry('shelf/own.md', 'Shelf says [[terms]].', null)
    ]
  } as unknown as Index
  assert.deepEqual(linkedFrom(index, 'shelf/terms.md').map((each) => each.path), ['projects/b/draft/two.md', 'shelf/own.md'])
  assert.deepEqual(linkedFrom(index, 'projects/a/draft/terms.md').map((each) => each.path), ['projects/a/draft/one.md'])
  // A link reaches a file of another project when nothing of its own project or the shelf has the name.
  const across = {
    version: 5,
    files: [entry('projects/a/draft/only-here.md', 'Here.', 'a'), entry('projects/b/draft/looks.md', 'See [[only-here]].', 'b')]
  } as unknown as Index
  assert.deepEqual(linkedFrom(across, 'projects/a/draft/only-here.md').map((each) => each.path), ['projects/b/draft/looks.md'])
})

test('a link follows the file to its new name, with its heading and its words, and a link to another file stays', () => {
  const before = ['shelf/terms.md', 'projects/a/draft/old.md', 'projects/a/draft/other.md', 'projects/b/draft/old.md']
  const after = before.map((each) => (each === 'projects/a/draft/old.md' ? 'projects/a/draft/new.md' : each))
  const text = 'See [[old]], [[old.md#Part|the part]], [[other]] and [[old|]].'
  assert.equal(relink(text, 'a', before, after, 'projects/a/draft/old.md', 'projects/a/draft/new.md'), 'See [[new]], [[new.md#Part|the part]], [[other]] and [[new]].')
  // From project b, [[old]] means its own file, so it is not changed.
  assert.equal(relink('[[old]]', 'b', before, after, 'projects/a/draft/old.md', 'projects/a/draft/new.md'), '[[old]]')
})

test('the shortest name that means a file is its own, then more of its path', () => {
  const paths = ['projects/a/draft/notes.md', 'projects/b/draft/notes.md', 'projects/a/material/report.pdf']
  assert.equal(nameFor('projects/a/material/report.pdf', 'a', paths), 'report.pdf')
  assert.equal(nameFor('projects/a/draft/notes.md', 'a', paths), 'notes')
  assert.equal(nameFor('projects/b/draft/notes.md', null, paths), 'b/draft/notes')
})
