import { headerOf } from '../../shared/records'

/** Whether a document has a header worth drawing: it names an `id`, or a field that lists its choices. */
export const hasHeader = (text: string) => {
  const { fields, choices } = headerOf(text)
  return !!fields.id || Object.keys(choices).length > 0
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const today = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/**
 * What the front matter of a record says, as a row above the page: a field that lists its choices is a
 * menu, and the rest are read. The text of the page is still the file's, front matter too. The reader
 * picks the word, so a status or a verdict is never changed by anything else.
 */
export function RecordHeader(props: { text: string; onPick: (key: string, value: string) => void }) {
  const { fields, choices, order } = headerOf(props.text)
  const closed = ['closed', 'withdrawn', 'superseded', 'rejected'].includes(fields.status)
  return (
    <div className="record-head" role="group" aria-label="Fields of this record">
      {order
        .filter((key) => key !== 'title' && (fields[key] || choices[key]))
        .map((key) => {
          const options = choices[key]
          if (options) {
            const all = fields[key] && !options.includes(fields[key]) ? [fields[key], ...options] : options
            return (
              <label key={key} className="field">
                <span>{key}</span>
                <select value={fields[key]} aria-label={key} onChange={(event) => props.onPick(key, event.target.value)}>
                  <option value="" />
                  {all.map((each) => <option key={each}>{each}</option>)}
                </select>
              </label>
            )
          }
          const late = !closed && (key === 'due' || key === 'review') && DAY.test(fields[key]) && fields[key] < today()
          return (
            <span key={key} className={late ? 'field late' : 'field'} title={late ? 'This day has passed.' : undefined}>
              <span>{key}</span>
              {fields[key]}
            </span>
          )
        })}
    </div>
  )
}
