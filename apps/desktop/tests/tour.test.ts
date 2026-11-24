import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { parseComments } from '../src/shared/comments.ts'
import { propsOf } from '../src/shared/records.ts'
import { resolveWiki, wikiLinks } from '../src/shared/wiki.ts'
import { describeContext, listProjects, readProject } from '../src/main/context.ts'
import { copyTour } from '../src/main/tour.ts'

const TOUR = path.resolve(import.meta.dirname, '../tour')

const walk = async (dir: string, base = ''): Promise<string[]> =>
  (await Promise.all((await readdir(path.join(dir, base), { withFileTypes: true })).map(async (each) => (each.isDirectory() ? walk(dir, `${base}${each.name}/`) : [`${base}${each.name}`])))).flat()

test('the tour is copied as a context, and a folder of that name is never written over', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-tour-'))
  try {
    const into = path.join(root, 'Mate tour')
    await copyTour(TOUR, into)
    // What Mate keeps in a hidden folder is shipped under another name and given its own here.
    assert.equal(existsSync(path.join(into, 'mate-private')), false)
    assert.equal(existsSync(path.join(into, '.mate/projects/tour/panes/tasks.md')), true)
    assert.equal((await stat(path.join(into, 'shelf'))).isDirectory(), true)
    await assert.rejects(copyTour(TOUR, into), /already there/)

    assert.deepEqual(await listProjects(into), ['tour'])
    const view = await readProject(into, 'tour')
    assert.ok(view.drafts.length >= 7, 'the lessons are the project\'s documents')
    assert.equal((await describeContext(into)).projects.includes('tour'), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('every [[link]] in the tour means a file of it, but the one that is there to show a broken link', async () => {
  const files = (await walk(TOUR)).map((each) => (each.startsWith('mate-private/') ? `.mate/${each.slice('mate-private/'.length)}` : each))
  const paths = files.filter((each) => !each.startsWith('.mate/'))
  const broken: string[] = []
  for (const file of files.filter((each) => each.endsWith('.md'))) {
    const text = await readFile(path.join(TOUR, file.startsWith('.mate/') ? `mate-private/${file.slice('.mate/'.length)}` : file), 'utf8')
    const project = /^projects\/([^/]+)\//.exec(file)?.[1] ?? null
    for (const link of wikiLinks(text)) if (!resolveWiki(link.target, project, paths)) broken.push(`${file}: ${link.target}`)
  }
  assert.deepEqual(broken, ['projects/tour/links-and-the-graph.md: a-document-nobody-wrote'])
})

test('the lessons are what they say: a comment to answer, fields to change, a table to take the text from', async () => {
  const read = (file: string) => readFile(path.join(TOUR, file), 'utf8')
  assert.equal(parseComments(await read('projects/tour/read-and-comment.md')).length, 1)
  assert.deepEqual(propsOf(await read('projects/tour/fields-and-tags.md')).map((each) => each.key), ['owner', 'due'])
  assert.match(await read('projects/tour/start-here.md'), /^---\nstatus: final\n/)
  assert.match(await read('projects/tour/material/prices.csv'), /^item,unit,price\n/)
  // Every page the start page names is there, and each page of the project is named by it.
  const start = await read('projects/tour/start-here.md')
  const lessons = (await readdir(path.join(TOUR, 'projects/tour'))).filter((each) => each.endsWith('.md') && !['intents.md', 'principles.md', 'start-here.md'].includes(each))
  for (const lesson of lessons) assert.ok(start.includes(`[[${lesson.replace(/\.md$/, '')}]]`), `${lesson} is on the start page`)
})
