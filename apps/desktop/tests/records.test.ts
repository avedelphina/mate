import assert from 'node:assert/strict'
import test from 'node:test'
import { attention, headerOf, isClosed, recordOf, refRanges, refsOf, withField } from '../src/shared/records.ts'

const REG = `---
id: REG-0007
type: deviation         # finding | deviation | risk-acceptance | deadline
title: "NTLMv1 on DCs # still on"
status: open            # open | in-progress | closed
owner:                  # owner
source:                 # audit | project | incident | operations | REV-…
decision:               # remediate | accept | change-target (required for deviations)
due: 2026-10-01         # YYYY-MM-DD
---

## Description
`

test('the header gives each field, and the choices only a field whose comment lists plain words', () => {
  const { fields, choices } = headerOf(REG)
  assert.equal(fields.id, 'REG-0007')
  assert.equal(fields.title, 'NTLMv1 on DCs # still on')
  assert.equal(fields.owner, '')
  assert.deepEqual(choices.status, ['open', 'in-progress', 'closed'])
  assert.deepEqual(choices.decision, ['remediate', 'accept', 'change-target'])
  assert.equal(choices.source, undefined)
  assert.equal(choices.due, undefined)
  assert.deepEqual(headerOf('# no block').fields, {})
})

test('a field is set with its comment and the comment column kept; a template is no record', () => {
  const next = withField(REG, 'status', 'closed')
  assert.match(next, /^status: closed {10}# open \| in-progress \| closed$/m)
  assert.equal(next.slice(next.indexOf('## Description')), REG.slice(REG.indexOf('## Description')))
  assert.match(withField(REG, 'decision', 'accept'), /^decision: accept {8}# remediate/m)
  assert.match(withField(REG, 'review', '2027-01-01'), /^review: 2027-01-01\n---/m)
  assert.equal(withField(REG, 'status', 'a\nb'), REG)
  assert.equal(withField('# plain', 'status', 'x'), '# plain')
  assert.equal(recordOf('register/_template.md', REG), null)
  assert.equal(recordOf('projects/_template/README.md', '---\nid: key\n---\n'), null)
  assert.equal(recordOf('register/REG-0007-x.md', REG)?.id, 'REG-0007')
  assert.equal(recordOf('notes.md', '---\ntags: a\n---\n'), null)
})

test('attention follows the report of the template', () => {
  const make = (path: string, head: string) => recordOf(path, `---\n${head}\n---\n`)!
  const records = [
    make('register/REG-0001.md', 'id: REG-0001\ntype: finding\nstatus: open\nowner: Jan\ndue: 2026-11-01'),
    make('register/REG-0002.md', 'id: REG-0002\ntype: deviation\nstatus: open\nowner: Jan\nreview: 2026-11-30'),
    make('register/REG-0003.md', 'id: REG-0003\ntype: finding\nstatus: closed\ndue: 2026-01-01'),
    make('register/REG-0004.md', 'id: REG-0004\ntype: finding\nstatus: open\nowner: Jan\ndue: 2027-06-01'),
    make('decisions/ADR-0001.md', 'id: ADR-0001\nstatus: proposed'),
    make('decisions/ADR-0002.md', 'id: ADR-0002\nstatus: accepted\nreview: 2026-11-05'),
    make('reviews/REV-0001.md', 'id: REV-0001\nstatus: issued\ndue: 2026-01-01')
  ]
  const found = attention(records, '2026-11-10').map((each) => [each.record.id, each.why, each.date ?? ''])
  assert.deepEqual(found, [
    ['REG-0001', 'overdue', '2026-11-01'],
    ['ADR-0002', 'overdue', '2026-11-05'],
    ['REG-0002', 'soon', '2026-11-30'],
    ['REG-0002', 'no decision', ''],
    ['ADR-0001', 'waiting for a decision', '']
  ])
  assert.equal(isClosed(records[2]), true)
})

test('an ID in the text opens what it names, as a whole word only', () => {
  const adr = recordOf('decisions/ADR-0010-x.md', '---\nid: ADR-0010\n---\n')!
  const refs = refsOf(
    [
      { path: 'architecture/principles.md', text: '## P-01: Remove before you secure\n\n## P-02: Y\n' },
      { path: 'architecture/standards/STD-IAM-privileged-access.md', text: '' },
      { path: 'architecture/standards/_template.md', text: '' }
    ],
    [adr]
  )
  assert.deepEqual(refs, { 'P-01': 'architecture/principles.md', 'P-02': 'architecture/principles.md', 'STD-IAM-privileged-access': 'architecture/standards/STD-IAM-privileged-access.md', 'ADR-0010': 'decisions/ADR-0010-x.md' })
  const text = 'See ADR-0010, P-01 and `STD-IAM-privileged-access`; not ADR-00, P-010 or XADR-0010.'
  assert.deepEqual(
    refRanges(text, refs).map((each) => text.slice(each.start, each.end)),
    ['ADR-0010', 'P-01', 'STD-IAM-privileged-access']
  )
  assert.deepEqual(refRanges(text, {}), [])
})
