import assert from 'node:assert/strict'
import test from 'node:test'
import { iconOf, iconsIn } from '../src/shared/icons.ts'

test('an icon is one of the pictures Mate has, or one emoji, and nothing else', () => {
  assert.equal(iconOf('folder'), 'folder')
  assert.equal(iconOf(' shelf '), 'shelf')
  assert.equal(iconOf('📝'), '📝')
  assert.equal(iconOf('👩‍💻'), '👩‍💻', 'joined emoji are one mark')
  assert.equal(iconOf('👍🏽'), '👍🏽', 'a tone is part of the mark')
  assert.equal(iconOf('🇨🇿'), '🇨🇿', 'a flag is one mark')
  assert.equal(iconOf('📝📝'), null, 'two marks')
  assert.equal(iconOf('A'), null, 'a letter is no picture')
  assert.equal(iconOf('nope'), null, 'a name Mate does not have')
  assert.equal(iconOf('<svg onload=alert(1)>'), null)
  assert.equal(iconOf('![x](http://example.com/a.png)'), null)
  assert.equal(iconOf(''), null)
  assert.equal(iconOf(7), null)
})

test('the icons a file says are only those for a folder of the project with an icon that is one', () => {
  assert.deepEqual(iconsIn({ draft: '📝', 'a/b': 'tag', '../out': '📝', '.hidden': '📝', '': '📝', x: 'nope', y: 3 }), { draft: '📝', 'a/b': 'tag' })
  assert.deepEqual(iconsIn(null), {})
  assert.deepEqual(iconsIn(['📝']), {})
})
