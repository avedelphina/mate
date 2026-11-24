import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { launch } from './drive.ts'

test('a folder pinned on an earlier day is at the top of the files, and its cross takes it off', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-e2e-'))
  const context = path.join(root, 'example')
  await cp(path.resolve(import.meta.dirname, '../../../../contexts/_example'), context, { recursive: true })
  await mkdir(path.join(context, '.mate/projects/document-review'), { recursive: true })
  const pins = path.join(context, '.mate/projects/document-review/pins.json')
  await writeFile(pins, JSON.stringify(['draft', 'gone']))
  const app = await launch(context)
  try {
    await app.until(`document.querySelector('.rail h2')?.textContent === 'example'`, 'the context is open')
    await app.press('.rail .row', 'document-review')
    // The folder that is there is shown, with its files. The one that has gone shows nothing.
    await app.until(`document.querySelectorAll('.pinned summary').length === 1 && document.querySelector('.pinned summary').textContent === 'draft'`, 'the pinned folder')
    await app.until(`[...document.querySelectorAll('.pinned .row')].some((each) => each.textContent.startsWith('document.md'))`, 'its files')
    // The page has the button to chat about its file.
    assert.match(await app.page(`[...document.querySelectorAll('.center .bar button')].map((each) => each.getAttribute('aria-label')).join()`), /Chat about this/)
    await app.page(`document.querySelector('.pinned summary .add').click()`)
    await app.until(`!document.querySelector('.pinned')`, 'the pin taken off')
    assert.deepEqual(JSON.parse(await readFile(pins, 'utf8')), ['gone'], 'only the pin of the folder that has gone is left')
  } finally {
    await app.close()
    await rm(root, { recursive: true, force: true })
  }
})
