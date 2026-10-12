import { createElement, Fragment, useMemo, type ReactNode } from 'react'
import { renderMarkdown, type Piece } from './markdown'

/** A stretch of the document that a thread quotes. `id` is null for the passage being commented now. */
export type Passage = { id: string | null; tone?: 'pending' | 'found'; start: number; end: number }

/** One stretch of the text, cut wherever a passage starts or ends, so passages that overlap each keep their mark. */
function marked(
  text: string,
  from: number,
  to: number,
  passages: Passage[],
  active: string | null,
  onPick?: (id: string) => void
) {
  const inner = passages.flatMap((passage) => [passage.start, passage.end]).filter((cut) => cut > from && cut < to)
  const cuts = [...new Set([from, ...inner, to])].sort((a, b) => a - b)
  return cuts.slice(0, -1).map((start, index) => {
    const end = cuts[index + 1]
    const piece = text.slice(start, end)
    const over = passages.filter((passage) => passage.start <= start && passage.end >= end)
    if (over.length === 0) return piece
    const ids = over.flatMap((passage) => (passage.id === null ? [] : [passage.id]))
    const classes = [...new Set(over.map((passage) => passage.tone)), active !== null && ids.includes(active) && 'active']
    return (
      <mark
        key={start}
        className={classes.filter(Boolean).join(' ')}
        data-threads={ids.join(' ')}
        onClick={() => ids.length > 0 && onPick?.(ids[0])}
      >
        {piece}
      </mark>
    )
  })
}

/**
 * Markdown, drawn. Its markup is hidden and still in the page, so the text of the page is the
 * text of the file, character for character. pickPassage depends on that.
 */
export function Rendered(props: { text: string; passages?: Passage[]; active?: string | null; onPick?: (id: string) => void }) {
  const { text, passages = [], active = null, onPick } = props
  const pieces = useMemo(() => renderMarkdown(text), [text])
  const draw = (piece: Piece, index: number): ReactNode => {
    if ('tag' in piece) {
      const { tag, children, ...rest } = piece
      return createElement(tag, { key: index, ...rest }, children.map(draw))
    }
    if (piece.hidden) return <span key={index} className="syntax">{text.slice(piece.from, piece.to)}</span>
    return <Fragment key={index}>{marked(text, piece.from, piece.to, passages, active, onPick)}</Fragment>
  }
  return <>{pieces.map(draw)}</>
}
