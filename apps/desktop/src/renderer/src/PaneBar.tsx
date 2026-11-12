import type { ReactNode } from 'react'
import type { Pane } from './env.d'
import { useTyping } from './Steering'

/**
 * What the reader can do with a pane besides read it: type in it, show it in the file manager, and keep agents
 * from writing it. The pane itself is drawn by the caller, and only while the reader is not typing.
 */
export function PaneBar(props: {
  pane: Pane
  onSave: (base: string, text: string) => Promise<void>
  onLock: (locked: boolean) => void
  onReveal: () => void
  children: ReactNode
}) {
  const { pane, onSave, onLock, onReveal, children } = props
  const typing = useTyping(onSave)
  const manager = document.documentElement.dataset.platform === 'mac' ? 'Finder' : 'the file manager'
  return (
    <>
      <p className="meta asof">
        {pane.name}, written {new Date(pane.written).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}. It does
        not update itself. Ask the agent to write it again.
      </p>
      {typing.typing !== null ? (
        <>
          <textarea className="steer" aria-label={`The pane ${pane.name}`} value={typing.typing} onChange={(event) => typing.change(event.target.value)} autoFocus />
          {typing.error && <p className="error" role="alert">{typing.error}</p>}
          <button className="quiet" disabled={typing.typing === typing.base} onClick={typing.save}>Save</button>
          <button className="quiet" onClick={typing.cancel}>Cancel</button>
        </>
      ) : (
        <>
          <p className="actions">
            <button className="quiet" onClick={() => typing.begin(pane.text)}>Edit</button>
            <button className="quiet" onClick={onReveal}>Show in {manager}</button>
          </p>
          <label className="meta" title="An agent that writes this pane has its change held until you approve it. Tasks you tick and your own edits are not held.">
            <input type="checkbox" checked={pane.locked} onChange={(event) => onLock(event.target.checked)} /> Agents may not change this pane
          </label>
          {children}
        </>
      )}
    </>
  )
}
