import { useEffect, useState, type FormEvent } from 'react'
import { attention, groupOf, isClosed, type RecordRow } from '../../shared/records'

const said = (caught: unknown) => String((caught as Error)?.message ?? caught).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** The kinds of record the template's tool makes, by the word it takes. */
const KINDS = [
  { kind: 'adr', label: 'Decision' },
  { kind: 'review', label: 'Review' },
  { kind: 'reg', label: 'Register item' },
  { kind: 'meeting', label: 'Meeting' }
]
const TYPES = ['finding', 'deviation', 'risk-acceptance', 'deadline']
/** What each group of IDs is called. A group the template does not know is listed under its letters. */
const GROUPS: Record<string, string> = { ADR: 'Decisions', REV: 'Reviews', REG: 'Register', '': 'Projects' }

const today = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/**
 * The records of a project: documents that name an `id` in their front matter, such as the decisions,
 * reviews and register items of the security architecture template. What needs the reader is on top, as
 * `repo.py report` lists it, and then every record by its group. The files are the source: this reads them.
 *
 * With the template's tools in the project, in a context the reader trusts, a record can be made here,
 * and Word files built from the Markdown. Both run the repository's own tool, as a script does.
 */
export function Records(props: {
  project: string
  records: RecordRow[]
  /** The project has `tools/repo.py` / `tools/build-docs.sh`, and the reader trusts the context. */
  canMake: boolean
  canBuild: boolean
  trusted: boolean
  onOpen: (path: string) => void
  /** After a tool ran: the files of the project are others now. */
  onChanged: () => Promise<void>
  /** A Word file was built: show where it is. */
  onBuilt: (path: string) => void
  onClose: () => void
}) {
  const { project, records, canMake, canBuild, trusted, onOpen, onChanged, onBuilt, onClose } = props
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showClosed, setShowClosed] = useState(false)
  // The record being made: its kind, and the type a register item takes. Null when no one is making one.
  const [making, setMaking] = useState<{ kind: string; type: string; title: string } | null>(null)

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === 'Escape' && !making && onClose()
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose, making])

  async function make(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!making) return
    setBusy(true)
    setError(null)
    try {
      const path = await window.mate.newRecord(project, making.kind, making.title, making.kind === 'reg' ? making.type : undefined)
      setMaking(null)
      await onChanged()
      onOpen(path)
    } catch (caught) {
      setError(said(caught))
    } finally {
      setBusy(false)
    }
  }

  async function build() {
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const built = await window.mate.buildDocuments(project, '--all')
      await onChanged()
      setDone(built.built.length > 0 ? `Built ${built.built.join(', ')}.` : 'Nothing to build.')
      if (built.built[0]) onBuilt(built.built[0])
    } catch (caught) {
      setError(said(caught))
    } finally {
      setBusy(false)
    }
  }

  const needs = attention(records, today())
  const shown = records.filter((each) => showClosed || !isClosed(each))
  const groups = [...new Set(shown.map(groupOf))].sort((a, b) => Object.keys(GROUPS).indexOf(a) - Object.keys(GROUPS).indexOf(b) || a.localeCompare(b))
  const title = (record: RecordRow) => record.title || record.path.split('/').pop()!
  const link = (record: RecordRow) => (
    <button className="quiet" onClick={() => onOpen(record.path)} title={record.path}>
      {title(record)}
    </button>
  )

  return (
    <>
      <header className="bar">
        <span className="title">
          <strong>Records</strong>
          <span className="meta">{project}</span>
        </span>
        <span className="acts">
          <button className="quiet" title="Esc" onClick={onClose}>
            Close
          </button>
        </span>
      </header>
      <div className="scroll">
        <div className="page history records">
          <h1>Records</h1>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {done && <p className="meta" role="status">{done}</p>}
          {(canMake || canBuild) && (
            <p className="acts">
              {canMake && <button className="primary" disabled={busy} onClick={() => setMaking({ kind: 'adr', type: 'finding', title: '' })}>New record…</button>}
              {canBuild && (
                <button disabled={busy} title="Word files of every project and review, with the repository's tools/build-docs.sh. They go to dist/." onClick={() => void build()}>
                  {busy && !making ? 'Building…' : 'Build all documents'}
                </button>
              )}
            </p>
          )}
          {!trusted && <p className="meta">A record is made, and a document built, with the repository's own tools. Mate runs them only in a context you trust: trust this one in the Agent tab.</p>}
          {making && (
            <form className="acts" onSubmit={(event) => void make(event)}>
              <select aria-label="Kind of record" value={making.kind} onChange={(event) => setMaking({ ...making, kind: event.target.value })}>
                {KINDS.map((each) => <option key={each.kind} value={each.kind}>{each.label}</option>)}
              </select>
              {making.kind === 'reg' && (
                <select aria-label="Type of the register item" value={making.type} onChange={(event) => setMaking({ ...making, type: event.target.value })}>
                  {TYPES.map((each) => <option key={each}>{each}</option>)}
                </select>
              )}
              <input
                autoFocus
                value={making.title}
                placeholder="Title"
                aria-label="Title of the record"
                onChange={(event) => setMaking({ ...making, title: event.target.value })}
                onKeyDown={(event) => event.key === 'Escape' && setMaking(null)}
              />
              <button className="primary" disabled={busy || !making.title.trim()}>Make</button>
              <button type="button" className="quiet" onClick={() => setMaking(null)}>Cancel</button>
            </form>
          )}

          {records.length === 0 && <p className="meta">No document of this project names an id in its front matter yet.</p>}
          {needs.length > 0 && (
            <>
              <h2>Needs you</h2>
              <ul>
                {needs.map((each, at) => (
                  <li key={at}>
                    <span className="row">
                      <span>
                        <strong>{each.record.id}</strong> {link(each.record)}
                      </span>
                      <span className={each.why === 'overdue' ? 'meta late' : 'meta'}>
                        {each.date ? `${each.what} ${each.date}${each.why === 'overdue' ? ', past' : ''}` : each.why}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {groups.map((group) => (
            <section key={group}>
              <h2>{GROUPS[group] ?? group}</h2>
              <table>
                <tbody>
                  {shown
                    .filter((each) => groupOf(each) === group)
                    .sort((a, b) => a.id.localeCompare(b.id))
                    .map((each) => (
                      <tr key={each.path}>
                        <td><strong>{each.id}</strong></td>
                        <td>{link(each)}</td>
                        <td className="meta">{[each.status, each.fields.type, each.fields.verdict].filter(Boolean).join(' · ')}</td>
                        <td className="meta">{each.owner}</td>
                        <td className="meta">{each.fields.due || each.fields.review || each.fields.date || each.fields.created || ''}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </section>
          ))}
          {records.some(isClosed) && (
            <p className="meta">
              <label>
                <input type="checkbox" checked={showClosed} onChange={(event) => setShowClosed(event.target.checked)} /> Show closed, withdrawn, superseded and rejected records
              </label>
            </p>
          )}
        </div>
      </div>
    </>
  )
}
