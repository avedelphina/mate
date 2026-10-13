import { useEffect, useRef, useState } from 'react'

/** One thing the reader can go to or do. `hint` says what kind of thing it is. */
export type Act = { label: string; hint?: string; run: () => void }

/**
 * Everything the window can go to or do, found by typing. It is what the buttons already do, in
 * one list: the palette adds no way to do anything that has none.
 *
 * `acts` is the list as it was when the palette was opened, or null while it is closed.
 */
export function Palette(props: { acts: Act[] | null; onClose: () => void }) {
  const { acts, onClose } = props
  const box = useRef<HTMLDialogElement>(null)
  const [find, setFind] = useState('')
  const [at, setAt] = useState(0)

  // A dialog of the platform: it takes the focus, keeps it, and closes on Escape.
  useEffect(() => {
    if (acts && !box.current?.open) {
      setFind('')
      setAt(0)
      box.current?.showModal()
    }
    if (!acts && box.current?.open) box.current.close()
  }, [acts])

  const words = find.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = (acts ?? []).filter((each) => words.every((word) => `${each.label} ${each.hint ?? ''}`.toLowerCase().includes(word))).slice(0, 60)
  const pick = (act: Act | undefined) => {
    if (!act) return
    onClose()
    act.run()
  }

  return (
    <dialog ref={box} className="palette" aria-label="Go to, or do" onClose={onClose} onClick={(event) => event.target === box.current && onClose()}>
      <input
        className="search"
        aria-label="Go to, or do"
        placeholder="Go to a file, or do something"
        value={find}
        onChange={(event) => {
          setFind(event.target.value)
          setAt(0)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') setAt((now) => Math.min(now + 1, shown.length - 1))
          else if (event.key === 'ArrowUp') setAt((now) => Math.max(now - 1, 0))
          else if (event.key === 'Enter') pick(shown[at])
          else return
          event.preventDefault()
        }}
      />
      <ul>
        {shown.map((each, index) => (
          <li key={`${each.hint}:${each.label}`}>
            <button className={index === at ? 'row active' : 'row'} onMouseMove={() => setAt(index)} onClick={() => pick(each)}>
              <span>{each.label}</span>
              {each.hint && <span className="meta">{each.hint}</span>}
            </button>
          </li>
        ))}
      </ul>
      {acts && shown.length === 0 && <p className="meta">Nothing by that name.</p>}
    </dialog>
  )
}
