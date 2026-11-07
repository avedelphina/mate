import type { Edit } from './format'

/** A diagram to start from: working Mermaid the reader changes, not a blank page. */
export const STARTERS: { name: string; source: string }[] = [
  {
    name: 'Flowchart',
    source: 'flowchart TD\n  A[Start] --> B{Is it ready?}\n  B -- Yes --> C[Publish]\n  B -- No --> D[Fix it]\n  D --> B'
  },
  {
    name: 'Sequence',
    source: 'sequenceDiagram\n  Reader->>Agent: Asks\n  Agent-->>Reader: Proposes\n  Reader->>Draft: Decides'
  },
  {
    name: 'States',
    source: 'stateDiagram-v2\n  [*] --> Draft\n  Draft --> Review\n  Review --> Draft: changes\n  Review --> Shelf: publish'
  },
  {
    name: 'Timeline',
    source: 'timeline\n  title History\n  2026 : Idea\n       : First draft\n  2027 : Published'
  }
]

/** The edit that puts a fenced diagram after the line the caret is on, with blank lines around it, and the caret inside. */
export function insertDiagram(text: string, at: number, source: string): Edit {
  const next = text.indexOf('\n', at)
  const lineEnd = next === -1 ? text.length : next
  const head = text.slice(0, lineEnd)
  const before = head === '' || head.endsWith('\n\n') ? '' : head.endsWith('\n') ? '\n' : '\n\n'
  const after = text.startsWith('\n\n', lineEnd) ? '' : '\n'
  const insert = `${before}\`\`\`mermaid\n${source}\n\`\`\`${after}`
  const caret = lineEnd + before.length + '```mermaid\n'.length + source.length
  return { from: lineEnd, to: lineEnd, insert, select: [caret, caret] }
}
