import { useSyncExternalStore } from 'react'

/**
 * How wide the text of a page may be. It is the reader's taste and their screen's, not a fact about a context, so
 * it is kept in the window and not in a file. The text keeps a width to be read at; a table, code and a diagram
 * may use the room the page has, whatever the choice.
 */
export const MEASURES = [
  { value: 'comfortable', label: 'Comfortable', note: 'About 75 characters a line.' },
  { value: 'wide', label: 'Wide', note: 'About 110 characters a line.' },
  { value: 'full', label: 'Full', note: 'The whole page, however wide the window.' }
] as const
export type Measure = (typeof MEASURES)[number]['value']

const KEY = 'page-measure'
const CHANGED = 'page-measure-changed'
let memory: Measure | null = null

export function measure(): Measure {
  if (memory) return memory
  try {
    const kept = localStorage.getItem(KEY)
    return MEASURES.some((each) => each.value === kept) ? (kept as Measure) : 'wide'
  } catch {
    return 'wide'
  }
}

/** Show a choice on the window: the style sheet reads it from the root. */
export const applyMeasure = (value: Measure = measure()): void => {
  document.documentElement.dataset.measure = value
}

export function setMeasure(value: Measure): void {
  memory = value
  try {
    localStorage.setItem(KEY, value)
  } catch {
    // The choice is not kept. It still holds until the window closes.
  }
  applyMeasure(value)
  window.dispatchEvent(new Event(CHANGED))
}

export const useMeasure = (): Measure =>
  useSyncExternalStore(
    (listener) => (window.addEventListener(CHANGED, listener), () => window.removeEventListener(CHANGED, listener)),
    measure
  )
