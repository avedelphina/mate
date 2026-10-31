import { useState } from 'react'
import { Boundary } from './Boundary'
import { Rendered } from './Rendered'

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

/** The intents or the principles of the open project, in the margin. */
export function Steering(props: { title: string; text: string; onSave: (base: string, text: string) => Promise<void> }) {
  const { title, text, onSave } = props
  const steer = useSteering(onSave)
  return (
    <details open>
      <summary>{title}</summary>
      {steer.typing === null ? (
        <>
          <div className="prose"><Boundary what={`The ${title.toLowerCase()}`} of={text}><Rendered text={text} /></Boundary></div>
          <button className="quiet" onClick={() => steer.begin(text)}>Edit</button>
        </>
      ) : (
        <>
          <textarea className="steer" aria-label={title} value={steer.typing} onChange={(event) => steer.change(event.target.value)} autoFocus />
          {steer.error && <p className="error" role="alert">{steer.error}</p>}
          <button className="quiet" disabled={steer.typing === steer.base} onClick={steer.save}>Save</button>
          <button className="quiet" onClick={steer.cancel}>Cancel</button>
        </>
      )}
    </details>
  )
}
