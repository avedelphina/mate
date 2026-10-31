import assert from 'node:assert/strict'
import test from 'node:test'
import { noticeFor, seenOf } from '../src/shared/notice.ts'

const seen = (running: boolean, asks = 0, held = 0) => ({ running, asks, held })

test('the reader is told when an agent needs them, and not for what they already know', () => {
  // The first look at a session tells nothing: there is no before.
  assert.equal(noticeFor(undefined, seen(true), true), null)
  assert.equal(noticeFor(seen(true), seen(true), true), null)
  assert.equal(noticeFor(seen(true), seen(true, 1), true), 'Is asking you something.')
  assert.equal(noticeFor(seen(true, 1), seen(true, 1), true), null)
  assert.equal(noticeFor(seen(true), seen(true, 0, 1), true), 'Wants to change a file. It is held for you.')
  assert.equal(noticeFor(seen(true), seen(false), true), 'Has finished.')
  assert.equal(noticeFor(seen(true), seen(false), false), 'Has a plan for you to approve.')
  // A question is what the reader must answer first, when the turn also ended.
  assert.equal(noticeFor(seen(true), seen(false, 1), true), 'Is asking you something.')
  assert.equal(noticeFor(seen(false), seen(false), true), null)
})

test('only a file that waits for the reader counts as held', () => {
  assert.deepEqual(seenOf({ running: false, held: [{ state: 'waiting' }, { state: 'approved' }, { state: 'discarded' }], asks: [1, 2] }), seen(false, 2, 1))
  assert.deepEqual(seenOf({ running: true, held: [] }), seen(true, 0, 0))
})
