import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { launch } from './drive.ts'

const oneByOnePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

test('a local markdown image is loaded through the main process and has real dimensions', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-image-e2e-'))
  const context = path.join(root, 'example')
  await cp(path.resolve(import.meta.dirname, '../../../../contexts/_example'), context, { recursive: true })
  const project = path.join(context, 'projects/document-review')
  await writeFile(path.join(project, 'draft', 'image.png'), oneByOnePng)
  await writeFile(path.join(project, 'draft', 'image.md'), '# Picture\n\n![A screenshot](image.png)\n')
  const app = await launch(context)
  try {
    await app.until(`document.querySelector('.rail h2')?.textContent === 'example'`, 'the context is open')
    await app.press('.rail .row', 'document-review')
    await app.until(`document.querySelectorAll('.projects .tree .row').length > 0`, 'the project is open')
    await app.press('.projects .tree .row', 'image.md')
    await app.until(`document.querySelector('.center .bar')?.textContent.includes('image.md')`, 'the image document is open')
    await app.until(
      `(() => { const image = document.querySelector('img.markdown-image'); return !!image && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0 })()`,
      'the local image is loaded'
    )
    assert.deepEqual(
      await app.page(`(() => { const image = document.querySelector('img.markdown-image'); return { alt: image.alt, width: image.naturalWidth, height: image.naturalHeight } })()`),
      { alt: 'A screenshot', width: 1, height: 1 }
    )
    assert.equal(await app.page(`document.querySelector('.center .page').textContent.includes('image.png')`), true)
  } finally {
    await app.close()
    await rm(root, { recursive: true, force: true })
  }
})
