import { useEffect, useState } from 'react'

type Mermaid = typeof import('mermaid').default

let loaded: Promise<Mermaid> | null = null
let drawn = 0

/** Mermaid is large, so it is loaded the first time a diagram is drawn, and not before. */
function mermaid(dark: boolean): Promise<Mermaid> {
  loaded ??= import('mermaid').then((module) => module.default)
  return loaded.then((each) => {
    // strict: the labels are text, and no click or script of a diagram runs.
    each.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default', htmlLabels: false, flowchart: { htmlLabels: false } })
    return each
  })
}

type Drawn = { svg: string } | { error: string }

/**
 * A Mermaid diagram as a picture. It is an image with the drawing in its address, so nothing in it
 * can run, and no word of it is in the page: the text of the page stays the text of the file. A
 * mistake in the diagram is said by the stylesheet, from `data-error`, for the same reason.
 */
export function Diagram(props: { source: string; wait?: number }) {
  const { source, wait = 0 } = props
  const [now, setNow] = useState<Drawn | null>(null)

  useEffect(() => {
    let current = true
    const dark = matchMedia('(prefers-color-scheme: dark)').matches
    const timer = setTimeout(() => {
      mermaid(dark)
        .then(async (each) => {
          await each.parse(source)
          const { svg } = await each.render(`diagram-${++drawn}`, source)
          // Mermaid sizes the drawing to 100%, which an image cannot make sense of. Give it its own size.
          const box = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(svg)
          if (current) setNow({ svg: box ? svg.replace('width="100%"', `width="${box[1]}" height="${box[2]}"`) : svg })
        })
        .catch((caught: unknown) => {
          // The first line says what is wrong. The rest is the parser's picture of the text.
          if (current) setNow({ error: (caught instanceof Error ? caught.message : String(caught)).split('\n')[0] })
        })
    }, wait)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [source, wait])

  if (!now) return <figure className="diagram" aria-busy="true" />
  if ('error' in now) return <figure className="diagram bad" data-error={now.error} />
  return (
    <figure className="diagram">
      <img alt="A diagram" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(now.svg)}`} />
    </figure>
  )
}
