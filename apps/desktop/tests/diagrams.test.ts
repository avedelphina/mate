import assert from 'node:assert/strict'
import test from 'node:test'
import { insertDiagram, STARTERS } from '../src/shared/diagrams.ts'

const apply = (text: string, at: number) => {
  const edit = insertDiagram(text, at, 'flowchart TD\n  A --> B')
  return { text: text.slice(0, edit.from) + edit.insert + text.slice(edit.to), caret: edit.select[0] }
}

test('a diagram goes after the line the caret is on, with a blank line either side', () => {
  const { text } = apply('Intro words\nNext line\n', 3)
  assert.equal(text, 'Intro words\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\nNext line\n')
})

test('on an empty line it takes that line, and at the end of the file it ends with a newline', () => {
  assert.equal(apply('', 0).text, '```mermaid\nflowchart TD\n  A --> B\n```\n')
  assert.equal(apply('a\n\nb', 2).text, 'a\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\nb')
})

test('the caret is left inside the block, on the last line of the diagram', () => {
  const { text, caret } = apply('Intro', 5)
  assert.equal(text.slice(caret - 'A --> B'.length, caret), 'A --> B')
})

test('every starter is a diagram of its own kind', () => {
  assert.deepEqual(STARTERS.map((each) => each.source.split('\n')[0]), ['flowchart TD', 'sequenceDiagram', 'stateDiagram-v2', 'timeline'])
})
