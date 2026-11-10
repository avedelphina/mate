import { test } from 'node:test'
import assert from 'node:assert/strict'
import { step, type Message } from '../src/main/sessions.ts'

test('what an agent says before a step is put aside, and what follows the last step is the answer', () => {
  const answer: Message = { role: 'agent', text: '', tools: [] }
  answer.text += 'I will read it.\n\n'
  step(answer, 'Read a.md')
  step(answer, 'Read b.md')
  answer.text += 'Done.'
  assert.deepEqual(answer.aside, ['I will read it.'])
  assert.deepEqual(answer.tools, ['Read a.md', 'Read b.md'])
  assert.equal(answer.text, 'Done.')
})
