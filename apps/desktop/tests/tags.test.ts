import assert from 'node:assert/strict'
import test from 'node:test'
import { tagsOf } from '../src/shared/tags.ts'

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
