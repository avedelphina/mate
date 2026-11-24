import { useState } from 'react'
import { KNOWN, type PropUse } from '../../shared/props'
import { headerOf, propsOf } from '../../shared/records'
import { tagsOf } from '../../shared/tags'

const DAY = /^\d{4}-\d{2}-\d{2}$/
const KEY = /^[A-Za-z][\w-]*$/
const today = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** Whether the row has something to show: the document has a field of its own, apart from its tags. */
export const hasProps = (text: string) => propsOf(text).length > 0

/**
 * The front matter of a draft as a row above the page: each field is a box the reader can change, and
 * the button at the end lists what can be added, with a line on what each does. The text of the page is
 * still the file's, front matter too. The row is drawn beside the page, and what is typed in it is
 * written to the file by `onSet`, one field at a time, with `null` taking a field out.
 */
export function Properties(props: {
  text: string
  /** The menu of what can be added is open. */
  open: boolean
  onOpen: (open: boolean) => void
  /** What the context's documents use, or null until it is asked. */
  vocab: PropUse[] | null
  /** The choices each kind of record offers, from its templates, for a record that lost the lists in its own comments. */
  kinds: Record<string, Record<string, string[]>>
  onSet: (key: string, value: string | null) => void
  onTags: () => void
}) {
  const { fields, choices: own } = headerOf(props.text)
  const choices = { ...(props.kinds[/^([A-Za-z][A-Za-z0-9]*)-/.exec(fields.id ?? '')?.[1] ?? ''] ?? {}), ...own }
  const present = propsOf(props.text)
  const have = new Set([...present.map((each) => each.key), ...(tagsOf(props.text).length > 0 ? ['tags'] : [])])
  const known = new Map(KNOWN.map((each) => [each.key, each]))
  const used = new Map((props.vocab ?? []).map((each) => [each.key, each]))
  const [fresh, setFresh] = useState('')
  const [other, setOther] = useState('')
  const status = present.find((each) => each.key === 'status')?.value
  const closed = !!status && ['closed', 'withdrawn', 'superseded', 'rejected'].includes(status)

  // What can be added: what Mate knows first, then what other documents use.
  const offers = [
    ...KNOWN.filter((each) => !have.has(each.key)).map((each) => ({ key: each.key, meaning: each.meaning, count: used.get(each.key)?.count ?? 0 })),
    ...(props.vocab ?? []).filter((each) => !have.has(each.key) && !known.has(each.key)).map((each) => ({ key: each.key, meaning: '', count: each.count }))
  ]
  const add = (key: string) => {
    props.onOpen(false)
    if (key === 'tags') return props.onTags()
    setFresh(key)
    props.onSet(key, '')
  }

  return (
    <div className="record-head" role="group" aria-label="Fields of this document">
      {present.map(({ key, value, compound }) => {
        if (compound) {
          return (
            <span key={key} className="field" title="A list or a block. Change it in the file.">
              <span>{key}</span>
              <em>in the file</em>
            </span>
          )
        }
        // The ID is what other documents name, so it is read here and changed in the file.
        if (key === 'id') {
          return (
            <span key={key} className="field" title={known.get(key)?.meaning}>
              <span>{key}</span>
              {value}
            </span>
          )
        }
        const options = choices[key]
        const suggested = [...new Set([...(known.get(key)?.values ?? []), ...(used.get(key)?.values ?? [])])]
        const day = known.get(key)?.day || DAY.test(value)
        const late = !closed && (key === 'due' || key === 'review') && DAY.test(value) && value < today()
        return (
          <span key={`${key}:${value}`} className={late ? 'field late' : 'field'} title={late ? 'This day has passed.' : known.get(key)?.meaning}>
            <span>{key}</span>
            {options ? (
              <select value={value} aria-label={key} onChange={(event) => props.onSet(key, event.target.value)}>
                <option value="" />
                {(value && !options.includes(value) ? [value, ...options] : options).map((each) => <option key={each}>{each}</option>)}
              </select>
            ) : day ? (
              <input type="date" aria-label={key} defaultValue={DAY.test(value) ? value : ''} autoFocus={fresh === key} onChange={(event) => props.onSet(key, event.target.value)} />
            ) : (
              <input
                aria-label={key}
                list={suggested.length > 0 ? `values-${key}` : undefined}
                defaultValue={value}
                autoFocus={fresh === key}
                size={Math.max(6, Math.min(40, value.length + 1))}
                placeholder="…"
                onBlur={(event) => event.target.value.trim() !== value && props.onSet(key, event.target.value.trim())}
                // Enter saves at once and does not wait for the box to lose focus.
                onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.value.trim() !== value && props.onSet(key, event.currentTarget.value.trim())}
              />
            )}
            {suggested.length > 0 && !options && !day && <datalist id={`values-${key}`}>{suggested.map((each) => <option key={each} value={each} />)}</datalist>}
            <button type="button" className="quiet drop" aria-label={`Remove ${key}`} title={`Take ${key} out of the front matter`} onClick={() => props.onSet(key, null)}>×</button>
          </span>
        )
      })}
      <span className="add">
        <button type="button" className="quiet" aria-expanded={props.open} onClick={() => props.onOpen(!props.open)}>+ Property</button>
        {props.open && (
          <div className="prop-menu" role="menu" aria-label="Fields that can be added">
            {offers.map((each) => (
              <button key={each.key} type="button" role="menuitem" className="quiet" onClick={() => add(each.key)}>
                <b>{each.key}</b>
                <span>{[each.meaning, each.count > 0 ? `Used in ${each.count} ${each.count === 1 ? 'document' : 'documents'}.` : ''].filter(Boolean).join(' ')}</span>
              </button>
            ))}
            <form
              onSubmit={(event) => {
                event.preventDefault()
                if (KEY.test(other.trim())) {
                  add(other.trim())
                  setOther('')
                }
              }}
            >
              <input value={other} placeholder="Another field…" aria-label="Name of another field" title="Letters, numbers, dash and underscore" onChange={(event) => setOther(event.target.value)} />
            </form>
          </div>
        )}
      </span>
    </div>
  )
}
