import { useRef, type KeyboardEventHandler } from 'react'
import { format, type Format } from '../../shared/format'

const BUTTONS: { kind: Format; label: string; face: string; key?: string }[] = [
  { kind: 'bold', label: 'Bold', face: 'B', key: 'b' },
  { kind: 'italic', label: 'Italic', face: 'I', key: 'i' },
  { kind: 'code', label: 'Code', face: '<>' },
  { kind: 'link', label: 'Link', face: '↗', key: 'l' },
  { kind: 'heading', label: 'Heading', face: 'H' },
  { kind: 'bullet', label: 'Bulleted list', face: '•' },
  { kind: 'number', label: 'Numbered list', face: '1.' },
  { kind: 'task', label: 'Task list', face: '☐' },
  { kind: 'quote', label: 'Quote', face: '❝' }
]

/**
 * The field the reader types the file in, with a bar of buttons over it. A button changes the
 * text as typing does, so undo takes it back; it does nothing the reader could not type.
 */
export function Editor(props: { value: string; label: string; onChange: (text: string) => void; onBlur?: () => void; onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement> }) {
  const field = useRef<HTMLTextAreaElement>(null)

  const press = (kind: Format) => {
    const area = field.current
    if (!area) return
    const edit = format(area.value, area.selectionStart, area.selectionEnd, kind)
    area.focus()
    area.setSelectionRange(edit.from, edit.to)
    // ponytail: execCommand is deprecated but is the one way to type into a field and keep its undo; fall back to a plain set.
    if (!document.execCommand('insertText', false, edit.insert)) {
      props.onChange(area.value.slice(0, edit.from) + edit.insert + area.value.slice(edit.to))
    }
    area.setSelectionRange(edit.select[0], edit.select[1])
  }

  return (
    <>
      <div className="format" role="toolbar" aria-label="Format the text" onMouseDown={(event) => event.preventDefault()}>
        {BUTTONS.map((each) => (
          <button key={each.kind} className={`quiet kind-${each.kind}`} title={each.key ? `${each.label} (⌘${each.key.toUpperCase()})` : each.label} aria-label={each.label} onClick={() => press(each.kind)}>
            {each.face}
          </button>
        ))}
      </div>
      <textarea
        ref={field}
        className="page editor"
        aria-label={props.label}
        value={props.value}
        spellCheck
        autoFocus
        onChange={(event) => props.onChange(event.target.value)}
        onBlur={props.onBlur}
        onKeyDown={(event) => {
          const button = (event.metaKey || event.ctrlKey) && !event.altKey && BUTTONS.find((each) => each.key === event.key.toLowerCase())
          if (button) {
            event.preventDefault()
            press(button.kind)
            return
          }
          props.onKeyDown?.(event)
        }}
      />
    </>
  )
}
