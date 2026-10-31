import { useState } from 'react'

/**
 * Typing in the intents or the principles. They steer an agent, so the reader types them, here and
 * nowhere else. `onSave` is given the text the reader began from, and refuses when the file holds another.
 */
export function useSteering(onSave: (base: string, text: string) => Promise<void>) {
  const [typing, setTyping] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The text the reader began from, kept so that a file written meanwhile is not written over.
  const [base, setBase] = useState('')
  return {
    typing,
    base,
    error,
    change: setTyping,
    begin(text: string) {
      setBase(text)
      setTyping(text)
      setError(null)
    },
    cancel() {
      setTyping(null)
      setError(null)
    },
    save() {
      if (typing === null) return
      setError(null)
      onSave(base, typing).then(
        () => setTyping(null),
        (caught) => setError(caught instanceof Error ? caught.message : 'Could not save.')
      )
    }
  }
}
