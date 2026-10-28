import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { refreshIndex } from '../src/main/contextIndex.ts'
import { passages, refreshMeaning, searchMeaning, type Embed } from '../src/main/meaning.ts'

test('a text is cut into passages of about a page, at paragraphs, and a long paragraph after a sentence', () => {
  // A heading and a short paragraph are one passage.
  assert.deepEqual(passages('# Title\n\nOne short paragraph.\n'), [{ start: 0, end: 29 }])
  const paragraph = (n: number) => `Paragraph ${n}. ` + 'Words of it. '.repeat(30)
  const text = Array.from({ length: 6 }, (_, n) => paragraph(n)).join('\n\n')
  const found = passages(text)
  assert.ok(found.length >= 2)
  for (const each of found) assert.ok(each.end - each.start <= 1500)
  // Nothing of the text is left out, and nothing is in two passages.
  assert.equal(found.map((each) => text.slice(each.start, each.end)).join('').replace(/\s/g, ''), text.replace(/\s/g, ''))
  const long = 'A sentence that goes on for a while. '.repeat(120)
  for (const each of passages(long)) assert.match(long.slice(each.start, each.end).trimEnd(), /\.$/)
  assert.deepEqual(passages('\n\n   \n'), [])
})

test('passages get their vectors once, again when their file changes, and the closest to a question come first', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-meaning-'))
  // A stand-in model: one dimension for each topic, whatever the language. That is what a real one is good for.
  const topics = [/retention|uchováv|keep/i, /password|hesl/i, /backup|zálo/i, /kitchen|kuchyň/i]
  const asked: string[] = []
  const embed: Embed = async (texts) => {
    asked.push(...texts)
    return texts.map((text) => topics.map((topic) => (topic.test(text) ? 1 : 0)).concat(0.1))
  }
  try {
    await mkdir(path.join(root, 'shelf'))
    await mkdir(path.join(root, 'projects/a/draft'), { recursive: true })
    await writeFile(path.join(root, 'shelf/records.md'), '# Záznamy\n\nDůvěrné záznamy se uchovávají deset let.\n')
    await writeFile(path.join(root, 'shelf/access.md'), '# Přístup\n\nHesla mají alespoň dvanáct znaků.\n')
    await writeFile(path.join(root, 'projects/a/draft/office.md'), '# Office\n\nThe kitchen is cleaned on Fridays.\n')

    // One passage for each of these short files, so one vector each.
    assert.equal(await refreshMeaning(root, await refreshIndex(root), embed), 3)
    assert.equal(asked.length, 3)
    assert.ok(existsSync(path.join(root, '.indexes/meaning.json')))
    // Nothing changed: nothing is asked again.
    assert.equal(await refreshMeaning(root, await refreshIndex(root), embed), 0)
    assert.equal(asked.length, 3)

    // The question is in another language and has no word of the passage. Its meaning finds it, at its place.
    // What is not close to it is not given at all.
    const hits = await searchMeaning(root, await refreshIndex(root), 'how long do we keep records', embed)
    assert.deepEqual(hits.map((hit) => hit.path), ['shelf/records.md'])
    assert.deepEqual(await searchMeaning(root, await refreshIndex(root), 'the weather tomorrow', embed), [])
    assert.equal(hits[0].kind, 'shelf')
    assert.match((await refreshIndex(root)).files.find((file) => file.path === 'shelf/records.md')!.text.slice(hits[0].start, hits[0].start + hits[0].length), /Důvěrné záznamy se uchovávají deset let\.$/)
    // For a question on the page, each passage comes whole, as the file has it: as many as asked for, and no more.
    assert.equal(hits[0].passage, (await refreshIndex(root)).files.find((file) => file.path === 'shelf/records.md')!.text.slice(hits[0].start!, hits[0].start! + hits[0].length))
    assert.deepEqual((await searchMeaning(root, await refreshIndex(root), 'keep records and passwords', embed)).map((hit) => hit.path).sort(), ['shelf/access.md', 'shelf/records.md'])
    assert.equal((await searchMeaning(root, await refreshIndex(root), 'keep records and passwords', embed, 1)).length, 1)

    // A changed file is done again, alone. A file that is gone is not found any more.
    await writeFile(path.join(root, 'shelf/access.md'), '# Přístup\n\nZálohy se dělají každou noc.\n')
    asked.length = 0
    assert.equal(await refreshMeaning(root, await refreshIndex(root), embed), 1)
    assert.ok(asked.every((text) => text.startsWith('Přístup')))
    assert.equal((await searchMeaning(root, await refreshIndex(root), 'backup', embed))[0].path, 'shelf/access.md')
    await rm(path.join(root, 'shelf/records.md'))
    assert.equal(await refreshMeaning(root, await refreshIndex(root), embed), 1)
    assert.ok((await searchMeaning(root, await refreshIndex(root), 'keep records', embed)).every((hit) => hit.path !== 'shelf/records.md'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
