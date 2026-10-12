import { GFM, parser } from '@lezer/markdown'

type SyntaxNode = ReturnType<typeof parser.parse>['topNode']

/** A stretch of the text. Hidden when it is markup the reader should not see, such as `**`. */
export type Leaf = { from: number; to: number; hidden: boolean }
export type Element = { tag: string; className?: string; title?: string; start?: number; children: Piece[] }
export type Piece = Leaf | Element

const markdown = parser.configure(GFM)

const TAGS: Record<string, [tag: string, className?: string]> = {
  Paragraph: ['p'],
  Blockquote: ['blockquote'],
  BulletList: ['ul'],
  OrderedList: ['ol'],
  ListItem: ['li'],
  ATXHeading1: ['h1'],
  ATXHeading2: ['h2'],
  ATXHeading3: ['h3'],
  ATXHeading4: ['h4'],
  ATXHeading5: ['h5'],
  ATXHeading6: ['h6'],
  SetextHeading1: ['h1'],
  SetextHeading2: ['h2'],
  Emphasis: ['em'],
  StrongEmphasis: ['strong'],
  Strikethrough: ['s'],
  InlineCode: ['code'],
  CodeBlock: ['pre'],
  Link: ['span', 'link'],
  Autolink: ['span', 'link'],
  Image: ['span', 'image'],
  // Not table elements: the text between two cells is still in the page, and a <tr> may not hold text.
  Table: ['div', 'table'],
  TableHeader: ['div', 'tr th'],
  TableRow: ['div', 'tr'],
  TableCell: ['div', 'td']
}

const HIDDEN = new Set([
  'HeaderMark',
  'QuoteMark',
  'ListMark',
  'LinkMark',
  'EmphasisMark',
  'StrikethroughMark',
  'CodeMark',
  'TableDelimiter',
  'LinkTitle',
  'LinkLabel'
])

/** Shown as written. Mate does not run HTML from a draft. */
const RAW: Record<string, string> = {
  HTMLBlock: 'div',
  CommentBlock: 'div',
  ProcessingInstructionBlock: 'div',
  LinkReference: 'div',
  HTMLTag: 'span',
  Comment: 'span',
  ProcessingInstruction: 'span'
}

/**
 * The markdown as a tree to draw.
 *
 * Every character of the text is in exactly one leaf, and the leaves are in order. Markup is
 * hidden, never removed. So what the reader selects on the page is a passage of the text itself,
 * and a comment can be anchored to it.
 */
export function renderMarkdown(text: string): Piece[] {
  // Front matter is not markdown. Read as markdown, its closing line would underline a heading.
  const meta = /^---\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(text)
  const base = meta ? meta[0].length : 0
  const source = text.slice(base)

  const leaf = (from: number, to: number, hidden = false): Leaf => ({ from: base + from, to: base + to, hidden })
  const filled = (pieces: Piece[]) => pieces.filter((piece) => 'tag' in piece || piece.to > piece.from)

  /** The node's children, and the text between them. */
  function inside(node: SyntaxNode, from = node.from, to = node.to): Piece[] {
    const pieces: Piece[] = []
    let at = from
    for (let child = node.firstChild; child && child.from < to; child = child.nextSibling) {
      pieces.push(leaf(at, child.from), ...piece(child))
      at = child.to
    }
    pieces.push(leaf(at, to))
    return filled(pieces)
  }

  function piece(node: SyntaxNode): Piece[] {
    const { name, from, to } = node
    if (HIDDEN.has(name)) return [leaf(from, to, true)]
    if (name in RAW) return [{ tag: RAW[name], className: 'raw', children: [leaf(from, to)] }]

    switch (name) {
      case 'URL': {
        // The address of a link is markup. An address written out in the prose is the text.
        const ofLink = node.parent?.name === 'Link' || node.parent?.name === 'Image'
        return ofLink ? [leaf(from, to, true)] : [{ tag: 'span', className: 'link', children: [leaf(from, to)] }]
      }
      case 'Escape':
        return [leaf(from, from + 1, true), leaf(from + 1, to)]
      case 'HardBreak':
        // Two spaces and a newline, or a backslash and a newline. The newline is what breaks the line.
        return [
          { tag: 'span', className: 'break', children: filled([leaf(from, to - 1, source[from] === '\\'), leaf(to - 1, to)]) }
        ]
      case 'HorizontalRule':
        return [{ tag: 'div', className: 'rule', children: [leaf(from, to, true)] }]
      case 'TaskMarker': {
        const checked = /x/i.test(source.slice(from, to))
        return [{ tag: 'span', className: checked ? 'box checked' : 'box', children: [leaf(from, to, true)] }]
      }
      case 'FencedCode': {
        // The fence lines are markup, and so are the newlines that end them.
        const firstBreak = source.indexOf('\n', from)
        const bodyStart = firstBreak < 0 || firstBreak >= to ? to : firstBreak + 1
        const closing = node.lastChild?.name === 'CodeMark' && node.lastChild.from >= bodyStart ? node.lastChild : null
        const bodyEnd = closing ? Math.max(bodyStart, source.lastIndexOf('\n', closing.from)) : to
        const children = filled([leaf(from, bodyStart, true), leaf(bodyStart, bodyEnd), leaf(bodyEnd, to, true)])
        return [{ tag: 'pre', children }]
      }
    }

    const tag = TAGS[name]
    // Document, Task, Entity and whatever the parser adds later: no element of their own.
    if (!tag) return inside(node)
    const element: Element = { tag: tag[0], className: tag[1], children: inside(node) }
    if (name === 'OrderedList') element.start = Number.parseInt(source.slice(from, to), 10) || 1
    if (name === 'Link' || name === 'Image') {
      // After the closing bracket comes the address, a title, a label. All of it is markup, spaces too.
      const closing = node.getChildren('LinkMark')[1]
      if (closing) element.children = [...inside(node, from, closing.from), leaf(closing.from, to, true)]
      const address = node.getChild('URL')
      if (address) element.title = source.slice(address.from, address.to)
    }
    return [element]
  }

  const body = inside(markdown.parse(source).topNode, 0, source.length)
  return meta ? [{ tag: 'pre', className: 'meta', children: [{ from: 0, to: base, hidden: false }] }, ...body] : body
}
