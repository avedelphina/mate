import assert from 'node:assert/strict'
import test from 'node:test'
import { tagPaths, tagsOf, under } from '../src/shared/tags.ts'

const read = (text: string) => tagsOf(text).map((each) => [each.tag, text.slice(each.at, each.at + each.length)])

test('the tags of a document are those its front matter names, in any of three forms', () => {
  assert.deepEqual(read('---\ntitle: A\ntags: contract, Legal Review, "q4"\n---\n# x\n'), [
    ['contract', 'contract'],
    ['Legal-Review', 'Legal Review'],
    ['q4', '"q4"']
  ])
  assert.deepEqual(read('---\ntags: [a, #b]\n---\nbody'), [['a', 'a'], ['b', '#b']])
  assert.deepEqual(read('---\ntags:\n  - one\n  - two words\nauthor: x\n- not: a tag\n---\n'), [['one', 'one'], ['two-words', 'two words']])
})

test('words that look like tags are not tags unless the front matter names them', () => {
  assert.deepEqual(tagsOf('tags: x\n\n# Not front matter\n'), [])
  assert.deepEqual(tagsOf('---\nauthor: x\n---\ntags: late\n'), [])
  assert.deepEqual(tagsOf('---\ntags:\n---\n'), [])
})

test('a slash nests a tag, a file shows under every tag it names, and #work finds work/clients', () => {
  assert.deepEqual(read('---\ntags: work / clients, /a//b/\n---\n'), [['work/clients', 'work / clients'], ['a/b', '/a//b/']])
  const shown = tagPaths({ 'draft/nda.md': ['work/clients', 'legal'], 'draft/old/nda.md': ['Work/clients'], 'notes.md': ['work'] })
  assert.deepEqual([...shown], [
    ['work/clients/nda.md', 'draft/nda.md'],
    ['legal/nda.md', 'draft/nda.md'],
    // The same name under the same tag is told by its folders, and Work is spelled as it was first met.
    ['work/clients/draft › old › nda.md', 'draft/old/nda.md'],
    ['work/notes.md', 'notes.md']
  ])
  assert.equal(under('work/clients', 'work'), true)
  assert.equal(under('work', 'work'), true)
  assert.equal(under('workshop', 'work'), false)
})
