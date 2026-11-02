import { useEffect, useState } from 'react'
import { Icon } from './Icon'

// The icon the app is installed with, drawn from the same file.
const LOGO = new URL('../../../build/icon.svg', import.meta.url).href

type Held = Awaited<ReturnType<typeof window.mate.recentContexts>>

/**
 * The window while no context is open, as Xcode greets: the app and its version, the two ways to
 * start, and the contexts opened last. One of those opens with a click.
 */
export function Welcome(props: { error: string | null; onOpen: () => void; onNew: () => void; onReopen: (dir: string) => void }) {
  const { error, onOpen, onNew, onReopen } = props
  const [held, setHeld] = useState<Held | null>(null)
  useEffect(() => void window.mate.recentContexts().then(setHeld, () => {}), [])
  return (
    <div className="welcome">
      <div className="card">
        <img className="logo" src={LOGO} alt="" width={112} height={112} />
        <h1>Mate</h1>
        <p className="meta">{held ? `Version ${held.version}` : ' '}</p>
        <p className="acts">
          <button onClick={onOpen}>Open context…</button>
          <button title="A new folder with a shelf, a dropbox and room for projects" onClick={onNew}>New context…</button>
        </p>
        {error && <p className="error" role="alert">{error}</p>}
        <ul className="recent">
          {held?.recent.map((each) => (
            <li key={each.dir}>
              <button className="row" title={each.dir} onClick={() => onReopen(each.dir)}>
                <Icon name="context" size={26} />
                <span>
                  <strong>{each.name}</strong>
                  <span className="meta">{each.shown}</span>
                </span>
              </button>
            </li>
          ))}
          {held?.recent.length === 0 && <li className="meta none">The contexts you open are listed here.</li>}
        </ul>
      </div>
    </div>
  )
}
