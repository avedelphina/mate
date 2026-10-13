import { createElement, Fragment, useMemo, type KeyboardEvent, type ReactNode } from 'react'
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
export function Rendered(props: {
  text: string
  passages?: Passage[]
  active?: string | null
  onPick?: (id: string) => void
  /** With this, a task box can be ticked. `at` is where its `[ ]` is in the text. */
  onTick?: (at: number) => void
  /** With this, a link written as `[words](say:)` is a button, and pressing it says its own words. */
  onSay?: (words: string) => void
  /** With this, a link written as `[scripts/NAME and what it is given](run:)` is a button that runs that script. */
  onRun?: (line: string) => void
  /** With this, words written as code open what they name. It gives the way to open it, or null when they name nothing. */
  onName?: (words: string) => (() => void) | null
}) {
  const { text, passages = [], active = null, onPick, onTick, onSay, onRun, onName } = props
  const pieces = useMemo(() => renderMarkdown(text), [text])
  /** The words of a piece as the reader sees them. */
  const shown = (piece: Piece): string => ('tag' in piece ? piece.children.map(shown).join('') : piece.hidden ? '' : text.slice(piece.from, piece.to))
  // Pressed with the mouse, or with the space bar or Enter when it has the focus.
  const pressable = (press: () => void) => ({
    tabIndex: 0,
    onClick: press,
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key !== ' ' && event.key !== 'Enter') return
      event.preventDefault()
      press()
    }
  })
  const draw = (piece: Piece, index: number): ReactNode => {
    if ('tag' in piece) {
      const { tag, children, ...rest } = piece
      const first = children[0]
      if (onTick && rest.className?.startsWith('box') && first && !('tag' in first)) {
        const act = { role: 'checkbox', 'aria-checked': rest.className.includes('checked'), ...pressable(() => onTick(first.from)) }
        return createElement(tag, { key: index, ...rest, ...act }, children.map(draw))
      }
      // The button reads what it says. Nothing is said that the reader does not see.
      if (onSay && rest.className === 'link' && rest.title === 'say:') {
        const act = { className: 'say', title: 'Say this to the agent', role: 'button', ...pressable(() => onSay(shown(piece))) }
        return createElement(tag, { key: index, ...act }, children.map(draw))
      }
      // The button reads the script and what it is given. That line is what runs.
      if (onRun && rest.className === 'link' && rest.title === 'run:') {
        const act = { className: 'say run', title: 'Run this script here. No agent is asked.', role: 'button', ...pressable(() => onRun(shown(piece))) }
        return createElement(tag, { key: index, ...act }, children.map(draw))
      }
      // The name of a file, written as code, opens that file. The words stay as they are.
      const open = onName && tag === 'code' ? onName(shown(piece)) : null
      if (open) return createElement(tag, { key: index, ...rest, className: 'named', title: 'Open this file', role: 'link', ...pressable(open) }, children.map(draw))
      return createElement(tag, { key: index, ...rest }, children.map(draw))
    }
    if (piece.hidden) return <span key={index} className="syntax">{text.slice(piece.from, piece.to)}</span>
    return <Fragment key={index}>{marked(text, piece.from, piece.to, passages, active, onPick)}</Fragment>
  }
  return <>{pieces.map(draw)}</>
}
