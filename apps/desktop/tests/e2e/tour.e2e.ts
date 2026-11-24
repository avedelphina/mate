import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { copyTour } from '../../src/main/tour.ts'
import { launch } from './drive.ts'

const names = (selector: string) => `[...document.querySelectorAll(${JSON.stringify(selector)})].map((each) => each.textContent.trim())`

test('the tour, opened as a context: its lessons are drafts, they link to each other, and the fields can be changed', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-e2e-tour-'))
  const context = path.join(root, 'Mate tour')
  // What "Take the tour" does after the reader has chosen where, the dialog of the system being what a test cannot press.
  await copyTour(path.resolve(import.meta.dirname, '../../tour'), context)
  const app = await launch(context)
  try {
    await app.until(`document.querySelector('.rail h2')?.textContent === 'Mate tour'`, 'the tour is the open context')
    await app.press('.rail .row', 'tour')
    await app.until(`document.querySelectorAll('.projects .tree .row').length > 5`, 'the lessons in the tree')
    const rows = await app.page<string[]>(names('.projects .tree .row'))
    for (const lesson of ['start-here.md', 'read-and-comment.md', 'links-and-the-graph.md', 'sources.md']) assert.ok(rows.some((each) => each.startsWith(lesson)), `${lesson} is in the tree`)
    assert.ok(((await app.page<string[]>(names('.margin .tabs button'))).join().includes('tasks')), 'the pane that came with the tour')

    // A lesson opens, and its links open the next one. A name no file has is dashed.
    await app.press('.projects .tree .row', 'start-here.md')
    await app.until(`document.querySelector('.center .bar')?.textContent.includes('start-here.md')`, 'the start page')
    await app.page(`[...document.querySelectorAll('.page .ref')].find((each) => each.textContent === 'read-and-comment').click()`)
    await app.until(`document.querySelector('.center .bar')?.textContent.includes('read-and-comment.md')`, 'the first lesson, opened from a link')
    assert.ok((await app.page<number>(`document.querySelectorAll('.page mark').length`)) >= 1, 'the sentence with a comment on it is marked')

    // The fields of a lesson are boxes.
    await app.press('.projects .tree .row', 'fields-and-tags.md')
    await app.until(`document.querySelector('.record-head input[aria-label="owner"]')?.value === 'you'`, 'the owner field')
    await app.press('.projects .tree .row', 'links-and-the-graph.md')
    await app.until(`document.querySelectorAll('.page .ref.missing').length >= 1`, 'the link that is there to be broken, dashed')
  } finally {
    await app.close()
    await rm(root, { recursive: true, force: true })
  }
})
