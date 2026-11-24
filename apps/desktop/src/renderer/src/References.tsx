import { useState, type FormEvent } from 'react'
import type { Reference } from '../../shared/references'

type Listed = Reference & { there: boolean }
const said = (caught: unknown) => String((caught as Error)?.message ?? caught).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/**
 * The places outside this context that agents are told of: a folder of another repository, a file. Nothing is
 * copied or read here. A reference is a name, where it lies, and a line on when to look there. The reader chooses
 * the place in a dialog of the system, and an agent reads it only when asked, and never writes there.
 */
export function References(props: { items: Listed[]; onChange: (items: Listed[]) => void; onClose: () => void }) {
  const [name, setName] = useState('')
  const [about, setAbout] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    try {
      const next = await window.mate.addReference(name, about)
      if (!next) return
      props.onChange(next)
      setName('')
      setAbout('')
    } catch (caught) {
      setError(said(caught))
    }
  }

  return (
    <>
      <header className="bar">
        <span className="title">
          <strong>References</strong>
          <span className="meta">outside this context</span>
        </span>
        <span className="acts">
          <button className="quiet" title="Esc" onClick={props.onClose}>
            Close
          </button>
        </span>
      </header>
      <div className="scroll">
        <div className="page history records">
          <h1>References</h1>
          <p className="meta">
            A place outside this context that agents are told of, such as the folder of another repository. Nothing is copied. An agent looks there only when you ask about it, and never writes there. [[name]] in a
            document names one.
          </p>
          {props.items.length === 0 && <p className="meta">None yet.</p>}
          {props.items.map((each) => (
            <div key={each.name} className="row">
              <span>
                <strong>{each.name}</strong> <span className="meta">{each.kind}{each.there ? '' : ', not there'}</span>
                <br />
                <span className="meta">{each.path}</span>
                {each.about && (
                  <>
                    <br />
                    {each.about}
                  </>
                )}
              </span>
              <span className="acts">
                <button className="quiet" disabled={!each.there} onClick={() => void window.mate.revealReference(each.name).catch((caught) => setError(said(caught)))}>
                  Show it
                </button>
                <button className="quiet" onClick={() => void window.mate.removeReference(each.name).then(props.onChange, (caught) => setError(said(caught)))}>
                  Remove
                </button>
              </span>
            </div>
          ))}
          <h2>Add one</h2>
          <form className="acts" onSubmit={add}>
            <input value={name} placeholder="Name (the folder's own, if empty)" aria-label="Name of the reference" onChange={(event) => setName(event.target.value)} />
            <input value={about} placeholder="When to look there" aria-label="When to look there" onChange={(event) => setAbout(event.target.value)} />
            <button className="primary" title="You choose the folder or the file in the dialog of the system">Choose the folder or file…</button>
          </form>
          {error && <p className="error">{error}</p>}
        </div>
      </div>
    </>
  )
}
