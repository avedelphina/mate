import assert from 'node:assert/strict'
import test from 'node:test'

// The window is not there in a test: a text box and a store stand in for it.
class Box {}
const store = new Map<string, string>()
Object.assign(globalThis, {
  HTMLTextAreaElement: Box,
  localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) },
  window: { dispatchEvent: () => true }
})
const { sends, setEnterSends } = await import('../src/renderer/src/keys.ts')

const press = (init: { key?: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; composing?: boolean; in?: object }) =>
  ({ key: 'Enter', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, nativeEvent: { isComposing: init.composing ?? false }, target: init.in ?? new Box(), ...init }) as never

test('by default only ⌘↵ or Ctrl+Enter sends, and with the setting on a plain Enter in a text box does too', () => {
  setEnterSends(false)
  assert.equal(sends(press({})), false)
  assert.equal(sends(press({ metaKey: true })), true)
  assert.equal(sends(press({ ctrlKey: true })), true)

  setEnterSends(true)
  assert.equal(sends(press({})), true)
  // Shift+Enter breaks the line, a key still composing a character does not send, and a button that has the focus is not a text box.
  assert.equal(sends(press({ shiftKey: true })), false)
  assert.equal(sends(press({ composing: true })), false)
  assert.equal(sends(press({ in: {} })), false)
  assert.equal(sends(press({ key: 'a' })), false)
  // ⌘↵ still sends.
  assert.equal(sends(press({ metaKey: true })), true)
})
