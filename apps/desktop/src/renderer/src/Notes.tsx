import { Boundary } from './Boundary'
import { fileNamed } from '../../shared/named'
import { Rendered } from './Rendered'
import { useTyping } from './Steering'

/**
 * The note beside the file on the page, in the margin: what the file is for, a discussion, or
 * documentation. It is a file of the project, NAME.notes.md, and the reader types it. A file it
 * names as [[file]] is a button here, and an agent that reads the note reads those too.
 */
export function Notes(props: {
  project: string
  /** Every file of the project, to tell what a name in the note means. */
  files: string[]
  /** The file the note is about, from the project folder. */
  target: string
  text: string
  onSave: (base: string, text: string) => Promise<void>
  onOpen: (path: string) => void
}) {
  const { project, files, target, text, onSave, onOpen } = props
  const typing = useTyping(onSave)
  const named = [...new Set([...text.matchAll(/\[\[([^\]\n]+)\]\]/g)].map((each) => each[1].split('|')[0].trim()))]
  const name = target.split('/').pop()

  if (typing.typing !== null) {
    return (
      <>
        <textarea className="steer" aria-label={`The note on ${name}`} value={typing.typing} onChange={(event) => typing.change(event.target.value)} autoFocus />
        <p className="meta hint">Name a file as [[file]] and it opens from here. An agent reads those files with the note.</p>
        {typing.error && <p className="error" role="alert">{typing.error}</p>}
        <button className="quiet" disabled={typing.typing === typing.base} onClick={typing.save}>Save</button>
        <button className="quiet" onClick={typing.cancel}>Cancel</button>
      </>
    )
  }
  return (
    <>
      <p className="meta" title={`${target}.notes.md`}>Note on {name}</p>
      {text.trim() === '' ? (
        <p className="meta hint">No note on this file yet. Write what it is for, what was decided, or where it comes from.</p>
      ) : (
        <div className="prose"><Boundary what="The note" of={text}><Rendered text={text} /></Boundary></div>
      )}
      {named.length > 0 && (
        <p className="meta named-files">
          {named.map((each) => {
            const path = fileNamed(each, project, files)
            return path ? (
              <button key={each} className="named" title={`Open ${path}`} onClick={() => onOpen(path)}>{each}</button>
            ) : (
              <span key={each} title="No file of this project has that name">{each}</span>
            )
          })}
        </p>
      )}
      <button className="quiet" onClick={() => typing.begin(text)}>{text.trim() === '' ? 'Add a note' : 'Edit'}</button>
    </>
  )
}
