import assert from 'node:assert/strict'
import test from 'node:test'
import { statusOf } from '../src/shared/status.ts'

test('a document says it is final in its front matter, and nowhere else', () => {
  assert.equal(statusOf('---\ntitle: A\nstatus: final\n---\n# A\n'), 'final')
  assert.equal(statusOf('---\nStatus: "Final"\r\n---\n'), 'final')
  assert.equal(statusOf('---\nstatus: draft\n---\n'), 'draft')
  assert.equal(statusOf('---\ntitle: A\n---\nstatus: final\n'), null)
  assert.equal(statusOf('status: final\n\n# Not front matter\n'), null)
  assert.equal(statusOf('---\nstatus:\n---\n'), null)
})
