import { useSyncExternalStore, type KeyboardEvent } from 'react'

/**
 * Which key sends a message to an agent. It is the reader's habit and not a fact about a context, so it is
 * kept in the window and not in a file. By default ⌘↵ (Ctrl+Enter) sends and Enter breaks the line.
 */
const KEY = 'send-with-enter'
const CHANGED = 'send-with-enter-changed'

export const enterSends = (): boolean => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setEnterSends(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    // The choice is not kept. It still holds until the window closes.
    memory = on
  }
  window.dispatchEvent(new Event(CHANGED))
}

let memory: boolean | null = null
const read = (): boolean => (memory ?? enterSends())

/** The setting, drawn again where it is used when the reader changes it. */
export const useEnterSends = (): boolean =>
  useSyncExternalStore(
    (listen) => (window.addEventListener(CHANGED, listen), () => window.removeEventListener(CHANGED, listen)),
    read
  )

/**
 * Whether this key press sends. ⌘↵ or Ctrl+Enter always does. With the setting on, a plain Enter in a text box does too,
 * and Shift+Enter breaks the line. A key that composes a character (a dead key, an input method) never sends.
 */
export function sends(event: KeyboardEvent): boolean {
  if (event.key !== 'Enter' || event.nativeEvent.isComposing) return false
  if (event.metaKey || event.ctrlKey) return true
  return read() && !event.shiftKey && !event.altKey && event.target instanceof HTMLTextAreaElement
}

/** What to press, for the title of a Send button. */
export const sendKey = (enter: boolean): string => (enter ? 'Enter' : document.documentElement.dataset.platform === 'mac' ? '⌘↵' : 'Ctrl+Enter')
