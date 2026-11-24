import { useEffect, useMemo, useState } from 'react'
import { shownRows } from '../../shared/table'
import type { TableView } from './env.d'

const said = (caught: unknown) => String((caught as Error)?.message ?? caught).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const STEP = 500

/**
 * A table of the project, as rows and columns: a CSV, a TSV or a workbook. Under each column is a box for
 * words, and what does not hold them is hidden, so a long table can be looked at a part at a time. A press on
 * a heading puts the rows in order. Filtering and ordering hide and arrange rows in the view only: nothing of them
 * reaches the file. A CSV or TSV can be changed, and is written back as it was written; a workbook is only shown.
 */
export function Table(props: { project: string; path: string; onClose: () => void }) {
  const { project, path, onClose } = props
  const [view, setView] = useState<TableView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sheet, setSheet] = useState(0)
  // The rows as they are being changed, for the sheet shown. Only a table that can be changed has any.
  const [rows, setRows] = useState<string[][]>([])
  const [dirty, setDirty] = useState(false)
  const [header, setHeader] = useState(true)
  const [filters, setFilters] = useState<string[]>([])
  const [anywhere, setAnywhere] = useState('')
  const [sort, setSort] = useState<{ column: number; down: boolean } | null>(null)
  const [limit, setLimit] = useState(STEP)
  const [editing, setEditing] = useState<{ row: number; column: number } | null>(null)

  const take = (next: TableView, at = 0) => {
    setView(next)
    setSheet(at)
    setRows(next.sheets[at].rows.map((row) => [...row]))
    setDirty(false)
    setFilters([])
    setAnywhere('')
    setSort(null)
    setLimit(STEP)
    setEditing(null)
  }
  useEffect(() => {
    let current = true
    window.mate.readTable(project, path).then((next) => current && take(next), (caught) => current && setError(said(caught)))
    return () => {
      current = false
    }
  }, [project, path])

  const close = () => {
    if (dirty && !window.confirm('Leave the table? What you changed is not saved.')) return
    onClose()
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => event.key === 'Escape' && !editing && close()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  const columns = useMemo(() => rows.reduce((most, row) => Math.max(most, row.length), 0), [rows])
  const skip = header && rows.length > 0 ? 1 : 0
  const shown = useMemo(() => shownRows(rows, Array.from({ length: columns }, (_, column) => filters[column] ?? ''), anywhere, sort, skip), [rows, columns, filters, anywhere, sort, skip])
  const body = shown.slice(skip)
  const editable = view?.editable === true

  const change = (row: number, column: number, value: string) => {
    setRows((now) => now.map((cells, at) => (at === row ? Array.from({ length: Math.max(cells.length, column + 1) }, (_, each) => (each === column ? value : (cells[each] ?? ''))) : cells)))
    setDirty(true)
  }
  const addRow = () => {
    setRows((now) => [...now, Array.from({ length: Math.max(columns, 1) }, () => '')])
    setFilters([])
    setAnywhere('')
    setSort(null)
    setLimit(Number.MAX_SAFE_INTEGER)
    setDirty(true)
  }
  const addColumn = () => {
    setRows((now) => now.map((cells, at) => [...Array.from({ length: columns }, (_, each) => cells[each] ?? ''), at === 0 && header ? 'new' : '']))
    setDirty(true)
  }
  const dropRow = (row: number) => {
    setRows((now) => now.filter((_, at) => at !== row))
    setDirty(true)
  }
  async function save() {
    if (!view) return
    try {
      take(await window.mate.writeTable(project, path, rows, view.stamp))
      setError(null)
    } catch (caught) {
      setError(said(caught))
    }
  }
  const choose = (at: number) => {
    if (!view || (dirty && !window.confirm('Change sheet? What you changed is not saved.'))) return
    take(view, at)
  }
  const sorting = (column: number) => setSort((now) => (now?.column !== column ? { column, down: false } : now.down ? null : { column, down: true }))
  const cell = (row: number, column: number) => rows[row]?.[column] ?? ''
  const filtered = filters.some((each) => each.trim() !== '') || anywhere.trim() !== ''

  return (
    <>
      <header className="bar">
        <span className="title">
          <strong>{view?.name ?? path.split('/').pop()}</strong>
          <span className="meta">{view ? `${body.length}${filtered ? ` of ${rows.length - skip}` : ''} rows` : ''}</span>
        </span>
        <span className="acts">
          {view && (
            <label className="meta" title="Take the first row as the names of the columns: it stays on top, and is not filtered">
              <input type="checkbox" checked={header} onChange={(event) => (setHeader(event.target.checked), setSort(null))} /> Header row
            </label>
          )}
          {editable && <button className="quiet" onClick={addRow}>Add row</button>}
          {editable && <button className="quiet" onClick={addColumn}>Add column</button>}
          {filtered && <button className="quiet" onClick={() => (setFilters([]), setAnywhere(''))}>Clear filters</button>}
          {dirty && <button className="primary" onClick={() => void save()}>Save</button>}
          {dirty && <button className="quiet" onClick={() => view && take(view, sheet)}>Discard</button>}
          <button className="quiet" title="Esc" onClick={close}>Close</button>
        </span>
      </header>
      <div className="scroll">
        <div className="table-view">
          {error && <p className="error" role="alert">{error}</p>}
          {view && view.sheets.length > 1 && (
            <div className="tabs" role="group" aria-label="Sheets">
              {view.sheets.map((each, at) => (
                <button key={each.name} className={at === sheet ? 'active' : 'quiet'} aria-pressed={at === sheet} onClick={() => choose(at)}>{each.name}</button>
              ))}
            </div>
          )}
          {view && view.why && <p className="meta">{view.why}</p>}
          {view && (
            <input className="anywhere" value={anywhere} placeholder="Find in any column…" aria-label="Words to find in any column" onChange={(event) => setAnywhere(event.target.value)} />
          )}
          {view && rows.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th className="n" />
                  {Array.from({ length: columns }, (_, column) => (
                    <th key={column}>
                      <button className="quiet" title="Put the rows in order by this column" onClick={() => sorting(column)}>
                        {header ? cell(0, column) || `Column ${column + 1}` : `Column ${column + 1}`}
                        {sort?.column === column && <span aria-hidden="true">{sort.down ? ' ↓' : ' ↑'}</span>}
                      </button>
                      <input
                        value={filters[column] ?? ''}
                        placeholder="filter"
                        title="Words the cell holds. =words is exactly those words, !words is without them."
                        aria-label={`Filter column ${column + 1}`}
                        onChange={(event) => setFilters((now) => Object.assign([...now], { [column]: event.target.value }))}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.slice(0, limit).map((row) => (
                  <tr key={row}>
                    <td className="n">
                      {row + 1}
                      {editable && <button className="quiet drop" aria-label={`Remove row ${row + 1}`} title="Take the row out" onClick={() => dropRow(row)}>×</button>}
                    </td>
                    {Array.from({ length: columns }, (_, column) =>
                      editing?.row === row && editing.column === column ? (
                        <td key={column} className="editing">
                          <input
                            autoFocus
                            defaultValue={cell(row, column)}
                            aria-label={`Row ${row + 1}, column ${column + 1}`}
                            onBlur={(event) => (event.target.value !== cell(row, column) && change(row, column, event.target.value), setEditing(null))}
                            onKeyDown={(event) => {
                              if (event.key === 'Escape') (event.stopPropagation(), setEditing(null))
                              else if (event.key === 'Enter' || event.key === 'Tab') {
                                event.preventDefault()
                                if (event.currentTarget.value !== cell(row, column)) change(row, column, event.currentTarget.value)
                                setEditing(event.key === 'Tab' && column + 1 < columns ? { row, column: column + 1 } : null)
                              }
                            }}
                          />
                        </td>
                      ) : (
                        <td key={column} title={cell(row, column)} onClick={() => editable && setEditing({ row, column })}>{cell(row, column)}</td>
                      )
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {view && body.length > limit && (
            <p><button className="quiet" onClick={() => setLimit(limit + STEP)}>Show {Math.min(STEP, body.length - limit)} more of {body.length - limit}</button></p>
          )}
          {view && rows.length > 0 && body.length === 0 && <p className="meta">No row holds those words.</p>}
          {view && rows.length === 0 && <p className="meta">This table is empty.</p>}
        </div>
      </div>
    </>
  )
}
