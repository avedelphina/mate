import assert from 'node:assert/strict'
import test from 'node:test'
import { format, type Format } from '../src/shared/format.ts'

/** The text after the button, from `text` with the selection between « and ». */
const press = (marked: string, kind: Format) => {
  const start = marked.indexOf('«')
  const end = marked.indexOf('»') - 1
  const text = marked.replace('«', '').replace('»', '')
  const edit = format(text, start, end, kind)
  const after = text.slice(0, edit.from) + edit.insert + text.slice(edit.to)
  return after.slice(0, edit.select[0]) + '«' + after.slice(edit.select[0], edit.select[1]) + '»' + after.slice(edit.select[1])
}

test('bold wraps the selection, and again takes it off', () => {
  assert.equal(press('a «word» b', 'bold'), 'a **«word»** b')
  assert.equal(press('a **«word»** b', 'bold'), 'a «word» b')
  assert.equal(press('a «**word**» b', 'bold'), 'a «word» b')
})

test('with nothing selected the marks go in and the caret between them', () => {
  assert.equal(press('a «» b', 'italic'), 'a _«»_ b')
})

test('a link leaves its address selected', () => {
  assert.equal(press('see «here»', 'link'), 'see [here](«url»)')
})

test('a heading goes # to ## to ### and off', () => {
  assert.equal(press('«title»', 'heading'), '«# title»')
  assert.equal(press('«# title»', 'heading'), '«## title»')
  assert.equal(press('«### title»', 'heading'), '«title»')
})

test('a list prefixes every line the selection touches, and again takes it off', () => {
  assert.equal(press('x\n«a\nb»\ny', 'bullet'), 'x\n«- a\n- b»\ny')
  assert.equal(press('x\n«- a\n- b»\ny', 'bullet'), 'x\n«a\nb»\ny')
  assert.equal(press('«a\n\nb»', 'number'), '«1. a\n\n3. b»')
  assert.equal(press('«a»', 'task'), '«- [ ] a»')
})

test('a bullet turns a task into a bullet, not a bullet with a box', () => {
  assert.equal(press('«- [ ] a»', 'bullet'), '«- a»')
})

test('a selection that ends at the start of a line leaves that line alone', () => {
  const text = 'a\nb\n'
  const edit = format(text, 0, 2, 'quote')
  assert.equal(text.slice(0, edit.from) + edit.insert + text.slice(edit.to), '> a\nb\n')
})
