import assert from 'node:assert/strict'
import test from 'node:test'
import { graphOf, type Index } from '../src/main/contextIndex.ts'
import { layout } from '../src/shared/graph.ts'

test('a layout is the same every time, inside its box, with linked documents nearer than the rest', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f']
  const links: [number, number][] = [[0, 1], [1, 2], [0, 2], [3, 4], [4, 5], [3, 5]]
  const once = layout(ids, links)
  assert.deepEqual(layout(ids, links), once)
  for (const point of once) assert.ok(point.x >= 0 && point.x <= 1000 && point.y >= 0 && point.y <= 1000)
  const gap = (a: number, b: number) => Math.hypot(once[a].x - once[b].x, once[a].y - once[b].y)
  assert.ok(gap(0, 1) < gap(0, 4), 'two linked are nearer than two of the other group')
  assert.deepEqual(layout([], []), [])
  assert.deepEqual(layout(['only'], []), [{ x: 500, y: 500 }])
})

test('the graph has the documents that link, once each, and a link to nothing is left out', () => {
  const entry = (path: string, text: string, project: string | null, kind = 'draft') => ({ path, title: path, text, project, kind, mtime: 0, size: 0, comments: [], tags: [] })
  const index = {
    version: 5,
    files: [
      entry('shelf/terms.md', 'Terms.', null, 'shelf'),
      entry('projects/a/draft/one.md', 'See [[terms]] and [[terms|again]] and [[nothing]].', 'a'),
      entry('projects/a/draft/two.md', 'And [[one]] and [[terms]].', 'a'),
      entry('projects/a/draft/alone.md', 'Nothing here.', 'a')
    ]
  } as unknown as Index
  const graph = graphOf(index)
  assert.deepEqual(graph.nodes.map((each) => each.path), ['projects/a/draft/one.md', 'projects/a/draft/two.md', 'shelf/terms.md'])
  assert.deepEqual(graph.links, [['projects/a/draft/one.md', 'shelf/terms.md'], ['projects/a/draft/two.md', 'projects/a/draft/one.md'], ['projects/a/draft/two.md', 'shelf/terms.md']])
  assert.equal(graph.total, 3)
})
