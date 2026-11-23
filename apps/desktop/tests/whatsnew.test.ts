import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { entriesOf, keepSeenIn, markSeen, notesSince, whatsNew } from '../src/main/whatsnew.ts'

const LOG = `# Changelog

## Unreleased

### Added

- Not out yet.

## [0.10.0] - 2026-11-20

Ten.

### Added

- Ten thing.

## [0.9.0] - 2026-11-10

Nine.

## [0.2.0] - 2026-10-01

Two.
`

test('the sections after the version last seen, up to the one running, and never Unreleased', () => {
  assert.deepEqual(entriesOf(LOG).map((each) => each.version), ['0.10.0', '0.9.0', '0.2.0'])
  // 0.10 is after 0.9: versions are numbers, not words.
  assert.deepEqual(notesSince(LOG, '0.9.0', '0.10.0').map((each) => each.version), ['0.10.0'])
  assert.deepEqual(notesSince(LOG, '0.2.0', '0.10.0').map((each) => each.version), ['0.10.0', '0.9.0'])
  assert.deepEqual(notesSince(LOG, '0.2.0', '0.9.0').map((each) => each.version), ['0.9.0'])
  assert.deepEqual(notesSince(LOG, '0.10.0', '0.10.0'), [])
  assert.match(entriesOf(LOG)[0].body, /^Ten\.\n\n### Added\n\n- Ten thing\.$/)
})

test('what is new is shown once after an update, never on a first run, and again when asked for', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mate-news-'))
  const where = path.join(dir, 'seen.json')
  try {
    keepSeenIn(where)
    // A first run has nothing to compare with: it is noted, and nothing is shown.
    assert.equal(whatsNew(LOG, '0.9.0'), null)
    assert.equal(JSON.parse(await readFile(where, 'utf8')).version, '0.9.0')
    // The same version again: nothing.
    assert.equal(whatsNew(LOG, '0.9.0'), null)
    // An update: shown until the reader has seen it.
    assert.deepEqual(whatsNew(LOG, '0.10.0')?.map((each) => each.version), ['0.10.0'])
    assert.deepEqual(whatsNew(LOG, '0.10.0')?.map((each) => each.version), ['0.10.0'])
    markSeen('0.10.0')
    assert.equal(whatsNew(LOG, '0.10.0'), null)
    // It is kept: a new start reads it.
    keepSeenIn(where)
    assert.equal(whatsNew(LOG, '0.10.0'), null)
    // From the menu: the running version's own section.
    assert.deepEqual(whatsNew(LOG, '0.10.0', true)?.map((each) => each.version), ['0.10.0'])
    // A version with no section of its own (a build from a checkout) is noted, not shown.
    assert.equal(whatsNew(LOG, '0.10.1'), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
