import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { checkBase, checkLink, firecrawlView, keepFirecrawlIn, scrapePage, setFirecrawl } from '../src/main/firecrawl.ts'

// A stand-in for the keychain: anything but the key as it was given.
const seal = { encrypt: (text: string) => Buffer.from([...text].reverse().join('')), decrypt: (sealed: Buffer) => [...sealed.toString()].reverse().join('') }

test('a page comes back as markdown, asked with the reader\'s key; the key is kept sealed', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mate-firecrawl-'))
  const asked: { auth?: string; body?: { url: string; formats: string[] } } = {}
  const server = http.createServer((req, res) => {
    let text = ''
    req.on('data', (chunk) => (text += chunk))
    req.on('end', () => {
      if (req.url === '/v2/team/credit-usage') {
        const ok = req.headers.authorization === 'Bearer fc-secret'
        res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' })
        return void res.end(JSON.stringify(ok ? { success: true, data: { remainingCredits: 42 } } : { success: false, error: 'Unauthorized' }))
      }
      Object.assign(asked, { auth: req.headers.authorization, body: JSON.parse(text), path: req.url })
      const fail = asked.body!.url.endsWith('/gone')
      res.writeHead(fail ? 402 : 200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(fail ? { success: false, error: 'Out of credits' } : { success: true, data: { markdown: '# Hello\n\nA page.', metadata: { title: ['Hello page', 'x'] } } }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    keepFirecrawlIn(path.join(dir, 'firecrawl.json'), seal)
    assert.deepEqual(firecrawlView(), { hasKey: false, base: 'https://api.firecrawl.dev' })
    await assert.rejects(scrapePage('https://example.com/a'), /Add your Firecrawl key/)

    const here = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    // A key Firecrawl refuses is not saved; one it accepts is, and the credits left are reported.
    await assert.rejects(setFirecrawl('wrong', here), /did not accept/)
    assert.equal(firecrawlView().hasKey, false)
    assert.equal(await setFirecrawl('fc-secret', here), 'The key works. 42 credits left.')
    assert.equal(firecrawlView().hasKey, true)
    assert.equal((await readFile(path.join(dir, 'firecrawl.json'), 'utf8')).includes('fc-secret'), false)

    assert.deepEqual(await scrapePage('https://example.com/a'), { title: 'Hello page', markdown: '# Hello\n\nA page.' })
    assert.equal(asked.auth, 'Bearer fc-secret')
    assert.equal(asked.body?.url, 'https://example.com/a')
    await assert.rejects(scrapePage('https://example.com/gone'), /Out of credits/)

    // An empty key keeps the saved one while the address stays; a new address does not carry it along.
    assert.match(await setFirecrawl(undefined, here), /42 credits/)
    assert.equal(firecrawlView().hasKey, true)
    await setFirecrawl(undefined, '')
    assert.deepEqual(firecrawlView(), { hasKey: false, base: 'https://api.firecrawl.dev' })
  } finally {
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('addresses that cannot work are refused before anything is sent', () => {
  keepFirecrawlIn(path.join(os.tmpdir(), 'mate-firecrawl-none.json'), seal)
  for (const bad of ['ftp://example.com/x', 'file:///etc/passwd', 'https://user:pw@example.com/', 'http://localhost:3000/', 'http://192.168.1.5/', 'http://intranet/page', 'not an address']) {
    assert.throws(() => checkLink(bad), undefined, bad)
  }
  assert.equal(checkLink('https://example.com/a?b=1').hostname, 'example.com')
  assert.throws(() => checkBase('http://example.com'), /https/)
  assert.equal(checkBase('http://127.0.0.1:3002'), 'http://127.0.0.1:3002')
})
