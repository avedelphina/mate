import { useEffect, useRef, type ReactNode } from 'react'

export type News = { version: string; date: string; body: string }[]

/** `code` is drawn as code. The changelog uses nothing else inline that matters here. */
const inline = (text: string): ReactNode[] =>
  text.split(/(`[^`]+`)/).map((part, at) => (part.startsWith('`') && part.endsWith('`') && part.length > 2 ? <code key={at}>{part.slice(1, -1)}</code> : part))

/** A section of the changelog: paragraphs, `###` headings and `-` lists, which is all the file uses. */
function Section({ body }: { body: string }) {
  const out: ReactNode[] = []
  let items: string[] = []
  const flush = () => {
    if (items.length > 0) out.push(<ul key={out.length}>{items.map((each, at) => <li key={at}>{inline(each)}</li>)}</ul>)
    items = []
  }
  let paragraph: string[] = []
  const end = () => {
    if (paragraph.length > 0) out.push(<p key={out.length}>{inline(paragraph.join(' '))}</p>)
    paragraph = []
  }
  for (const line of body.split('\n')) {
    if (/^###\s/.test(line)) (end(), flush(), out.push(<h4 key={out.length}>{line.replace(/^###\s+/, '')}</h4>))
    else if (/^-\s/.test(line)) (end(), items.push(line.slice(2).trim()))
    else if (/^\s+\S/.test(line) && items.length > 0) items[items.length - 1] += ` ${line.trim()}`
    else if (line.trim() === '') (end(), flush())
    else (flush(), paragraph.push(line.trim()))
  }
  end()
  flush()
  return <>{out}</>
}

/** What changed, shown once after an update. A dialog of the platform: it takes the focus and closes on Escape. */
export function WhatsNew(props: { news: News | null; onClose: () => void }) {
  const { news, onClose } = props
  const box = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (news && !box.current?.open) box.current?.showModal()
    if (!news && box.current?.open) box.current.close()
  }, [news])
  return (
    <dialog ref={box} className="whatsnew" aria-label="What's new" onClose={onClose}>
      <h2>What's new in Mate</h2>
      <div className="notes">
        {news?.length === 0 && <p className="meta">This version has no notes.</p>}
        {news?.map((each) => (
          <section key={each.version}>
            <h3>
              {each.version} {each.date && <span className="meta">{each.date}</span>}
            </h3>
            <Section body={each.body} />
          </section>
        ))}
      </div>
      <p className="end"><button className="primary" autoFocus onClick={onClose}>Done</button></p>
    </dialog>
  )
}
