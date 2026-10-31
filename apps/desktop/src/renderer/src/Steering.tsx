import { useState } from 'react'
import { Boundary } from './Boundary'
import { Rendered } from './Rendered'

/**
 * The intents or the principles of the open project, in the margin. They steer an agent, so they
 * are typed here by the reader and nowhere else. `onSave` is given the text the reader began from.
 */
export function Steering(props: { title: string; text: string; onSave: (base: string, text: string) => Promise<void> }) {
  const { title, text, onSave } = props
  const [typing, setTyping] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The text the reader began from, kept so that a file written meanwhile is not written over.
  const [base, setBase] = useState(text)

  function save() {
    if (typing === null) return
    setError(null)
    onSave(base, typing).then(
      () => setTyping(null),
      (caught) => setError(caught instanceof Error ? caught.message : 'Could not save.')
    )
  }

  return (
    <details open>
      <summary>{title}</summary>
      {typing === null ? (
        <>
          <div className="prose"><Boundary what={`The ${title.toLowerCase()}`} of={text}><Rendered text={text} /></Boundary></div>
          <button className="quiet" onClick={() => (setBase(text), setTyping(text))}>Edit</button>
        </>
      ) : (
        <>
          <textarea className="steer" aria-label={title} value={typing} onChange={(event) => setTyping(event.target.value)} autoFocus />
          {error && <p className="error" role="alert">{error}</p>}
          <button className="quiet" disabled={typing === base} onClick={save}>Save</button>
          <button className="quiet" onClick={() => (setTyping(null), setError(null))}>Cancel</button>
        </>
      )}
    </details>
  )
}
