import { useEffect, useMemo, useRef, useState } from 'react'
import { layout } from '../../shared/graph'

type Data = Awaited<ReturnType<typeof window.mate.contextGraph>>
const said = (caught: unknown) => String((caught as Error)?.message ?? caught).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/**
 * The documents of the context that link to one another with `[[name]]`, drawn as points and lines: the
 * shelf in the accent, drafts dark, other files soft. A press opens one. It is read from the index, so it
 * shows what the files say now. The wheel zooms and a drag moves the drawing.
 */
export function Graph(props: { project: string; open: string | null; onOpen: (path: string) => void; onClose: () => void }) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mine, setMine] = useState(false)
  const [near, setNear] = useState<string | null>(null)
  const [box, setBox] = useState({ x: 0, y: 0, w: 1000, h: 1000 })
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const { onClose } = props

  useEffect(() => {
    let current = true
    window.mate.contextGraph().then((next) => current && setData(next), (caught) => current && setError(said(caught)))
    return () => {
      current = false
    }
  }, [])
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])

  // This project and the shelf, or all of it.
  const shown = useMemo(() => {
    if (!data) return null
    const nodes = mine ? data.nodes.filter((each) => each.project === props.project || each.path.startsWith('shelf/')) : data.nodes
    const have = new Set(nodes.map((each) => each.path))
    return { nodes, links: data.links.filter(([a, b]) => have.has(a) && have.has(b)) }
  }, [data, mine, props.project])
  const where = useMemo(() => {
    if (!shown) return []
    const at = new Map(shown.nodes.map((each, index) => [each.path, index]))
    return layout(shown.nodes.map((each) => each.path), shown.links.map(([a, b]) => [at.get(a)!, at.get(b)!]))
  }, [shown])
  const degree = useMemo(() => {
    const count = new Map<string, number>()
    for (const [a, b] of shown?.links ?? []) for (const end of [a, b]) count.set(end, (count.get(end) ?? 0) + 1)
    return count
  }, [shown])
  const neighbours = useMemo(() => {
    const around = new Set<string>()
    if (near) for (const [a, b] of shown?.links ?? []) (a === near && around.add(b)) || (b === near && around.add(a))
    return around
  }, [near, shown])

  const zoom = (event: React.WheelEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const factor = event.deltaY > 0 ? 1.15 : 1 / 1.15
    const px = box.x + ((event.clientX - rect.left) / rect.width) * box.w
    const py = box.y + ((event.clientY - rect.top) / rect.height) * box.h
    const w = Math.min(4000, Math.max(80, box.w * factor))
    const h = w * (box.h / box.w)
    setBox({ x: px - ((px - box.x) * w) / box.w, y: py - ((py - box.y) * h) / box.h, w, h })
  }

  const label = (path: string) => shown?.nodes.find((each) => each.path === path)?.title ?? path
  const few = (shown?.nodes.length ?? 0) <= 40

  return (
    <>
      <header className="bar">
        <span className="title">
          <strong>Graph</strong>
          <span className="meta">{shown ? `${shown.nodes.length} documents, ${shown.links.length} links` : ''}</span>
        </span>
        <span className="acts">
          <button className={mine ? 'active' : 'quiet'} aria-pressed={mine} title="Only the documents of this project and the shelf" onClick={() => setMine(!mine)}>
            This project
          </button>
          <button className="quiet" title="Show it all again" onClick={() => setBox({ x: 0, y: 0, w: 1000, h: 1000 })}>
            Fit
          </button>
          <button className="quiet" title="Esc" onClick={onClose}>
            Close
          </button>
        </span>
      </header>
      <div className="scroll">
        <div className="graph">
          {error && <p className="error">{error}</p>}
          {shown && shown.nodes.length === 0 && <p className="meta">No document links to another yet. A link is [[name]] in the text of a document.</p>}
          {data && data.total > data.nodes.length && <p className="meta">The {data.nodes.length} most linked of {data.total} documents are drawn.</p>}
          {shown && shown.nodes.length > 0 && (
            <svg
              role="img"
              aria-label="Links between documents"
              viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
              onWheel={zoom}
              onMouseDown={(event) => (drag.current = { x: event.clientX, y: event.clientY, moved: false })}
              onMouseMove={(event) => {
                if (!drag.current || event.buttons === 0) return
                const rect = event.currentTarget.getBoundingClientRect()
                const dx = ((event.clientX - drag.current.x) / rect.width) * box.w
                const dy = ((event.clientY - drag.current.y) / rect.height) * box.h
                if (Math.abs(event.clientX - drag.current.x) + Math.abs(event.clientY - drag.current.y) > 3) drag.current.moved = true
                drag.current = { x: event.clientX, y: event.clientY, moved: drag.current.moved }
                setBox((now) => ({ ...now, x: now.x - dx, y: now.y - dy }))
              }}
              onMouseUp={() => (drag.current = null)}
              onMouseLeave={() => (drag.current = null)}
            >
              {shown.links.map(([a, b]) => {
                const from = where[shown.nodes.findIndex((each) => each.path === a)]
                const to = where[shown.nodes.findIndex((each) => each.path === b)]
                const lit = near !== null && (a === near || b === near)
                return <line key={`${a}\n${b}`} className={lit ? 'edge lit' : 'edge'} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
              })}
              {shown.nodes.map((node, index) => {
                const at = where[index]
                const kind = node.path.startsWith('shelf/') ? 'shelf' : node.kind === 'draft' ? 'draft' : 'other'
                const lit = node.path === near || neighbours.has(node.path) || node.path === props.open
                return (
                  <g
                    key={node.path}
                    className={`node ${kind}${node.path === props.open ? ' open' : ''}${near !== null && !lit ? ' dim' : ''}`}
                    transform={`translate(${at.x} ${at.y})`}
                    role="link"
                    tabIndex={0}
                    aria-label={`${node.title}, ${node.path}`}
                    onMouseEnter={() => setNear(node.path)}
                    onMouseLeave={() => setNear(null)}
                    onClick={() => !drag.current?.moved && props.onOpen(node.path)}
                    onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && (event.preventDefault(), props.onOpen(node.path))}
                  >
                    <title>{node.path}</title>
                    <circle r={7 + 3 * Math.sqrt(degree.get(node.path) ?? 0)} />
                    {(few || lit || (degree.get(node.path) ?? 0) >= 4) && <text y={-12 - 3 * Math.sqrt(degree.get(node.path) ?? 0)}>{label(node.path)}</text>}
                  </g>
                )
              })}
            </svg>
          )}
        </div>
      </div>
    </>
  )
}
