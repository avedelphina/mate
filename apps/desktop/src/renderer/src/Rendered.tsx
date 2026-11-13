import { createElement, Fragment, useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { refRanges, type RefRange } from '../../shared/records'
import { Diagram } from './Diagram'
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
  onPick?: (id: string) => void,
  refs: RefRange[] = [],
  onRef?: (path: string) => void
) {
  const named = refs.filter((ref) => ref.end > from && ref.start < to)
  const inner = [...passages.flatMap((passage) => [passage.start, passage.end]), ...named.flatMap((ref) => [ref.start, ref.end])].filter((cut) => cut > from && cut < to)
  const cuts = [...new Set([from, ...inner, to])].sort((a, b) => a - b)
  return cuts.slice(0, -1).map((start, index) => {
    const end = cuts[index + 1]
    const ref = named.find((each) => each.start <= start && each.end >= end)
    // An ID that names a record is a link. The words are the same, so the page still holds the text of the file.
    const piece = ref ? (
      <span
        key={`ref${start}`}
        className="ref"
        role="link"
        tabIndex={0}
        title="Open it"
        onClick={(event) => {
          // Selecting the words is not pressing them.
          if (window.getSelection()?.toString()) return
          event.stopPropagation()
          onRef?.(ref.path)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          onRef?.(ref.path)
        }}
      >
        {text.slice(start, end)}
      </span>
    ) : (
      text.slice(start, end)
    )
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

function LocalImage(props: {
  path: string
  alt: string
  load: (path: string) => Promise<{ mimeType: string; data: string }>
}) {
  const { path, alt, load } = props
  const [source, setSource] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let current = true
    setSource(null)
    setFailed(false)
    load(path)
      .then((picture) => {
        if (current) setSource(`data:${picture.mimeType};base64,${picture.data}`)
      })
      .catch(() => current && setFailed(true))
    return () => {
      current = false
    }
  }, [load, path])

  if (!source) return <span className="image-preview" data-state={failed ? 'error' : 'loading'} role="img" aria-label={alt || 'Image'} />
  return <img className="markdown-image" src={source} alt={alt} />
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
  /** A file that is not markdown: its text as it is, in one block, with the same marks. */
  plain?: boolean
  /** With these, an ID such as `ADR-0004` in the text opens the file it names. `refs` maps each ID to a path. */
  refs?: Record<string, string>
  onRef?: (path: string) => void
  /** A local image path, resolved by main and returned as bytes. */
  image?: (path: string) => Promise<{ mimeType: string; data: string }>
}) {
  const { text, passages = [], active = null, onPick, onTick, onSay, onRun, onName, plain = false, refs, onRef, image } = props
  const named = useMemo(() => (refs && onRef && !plain ? refRanges(text, refs) : []), [text, refs, onRef, plain])
  const pieces = useMemo(() => (plain ? [] : renderMarkdown(text)), [text, plain])
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
      const { tag, children, diagram, src, alt, ...rest } = piece
      if (src && image) {
        return (
          <span key={index} className="image-rendered">
            <LocalImage path={src} alt={alt ?? ''} load={image} />
            {children.map(draw)}
          </span>
        )
      }
      if (diagram) {
        return (
          <Fragment key={index}>
            <Diagram source={text.slice(diagram[0], diagram[1])} />
            {createElement(tag, rest, children.map(draw))}
          </Fragment>
        )
      }
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
    return <Fragment key={index}>{marked(text, piece.from, piece.to, passages, active, onPick, named, onRef)}</Fragment>
  }
  if (plain) {
    // The line numbers are drawn by CSS from an attribute: they are beside the text, and not in it.
    const count = text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
    return (
      <div className="plain-file">
        <span className="gutter" aria-hidden="true" data-lines={Array.from({ length: count }, (_, at) => at + 1).join('\n')} />
        <pre className="plain">{marked(text, 0, text.length, passages, active, onPick)}</pre>
      </div>
    )
  }
  return <>{pieces.map(draw)}</>
}
