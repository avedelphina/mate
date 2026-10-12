/** One line of a comparison: kept, added, or taken out. */
export type DiffLine = { kind: ' ' | '+' | '-'; text: string }

// ponytail: a table of lines × lines. Past this many cells the two texts are shown as all out, all in.
// A document is far below it. Use a linear-space diff if large files are ever compared.
const MAX_CELLS = 4_000_000

const linesOf = (text: string) => (text === '' ? [] : text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n'))

/** The lines of `after` against the lines of `before`, in order. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = linesOf(before)
  const b = linesOf(after)
  const out: DiffLine[] = []
  if (a.length * b.length > MAX_CELLS) {
    return [...a.map((text) => ({ kind: '-' as const, text })), ...b.map((text) => ({ kind: '+' as const, text }))]
  }
  // How long the longest run of lines is that both texts share, from each pair of places to the end.
  const shared = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      shared[i][j] = a[i] === b[j] ? shared[i + 1][j + 1] + 1 : Math.max(shared[i + 1][j], shared[i][j + 1])
    }
  }
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) out.push({ kind: ' ', text: a[i++] }), j++
    else if (shared[i + 1][j] >= shared[i][j + 1]) out.push({ kind: '-', text: a[i++] })
    else out.push({ kind: '+', text: b[j++] })
  }
  while (i < a.length) out.push({ kind: '-', text: a[i++] })
  while (j < b.length) out.push({ kind: '+', text: b[j++] })
  return out
}

/** Only what changed, each change with a few lines around it. What is left out between two changes is one `⋯` line. */
export function changedParts(lines: DiffLine[], around = 2): DiffLine[] {
  const keep = lines.map(() => false)
  lines.forEach((line, at) => {
    if (line.kind === ' ') return
    for (let near = Math.max(0, at - around); near <= Math.min(lines.length - 1, at + around); near++) keep[near] = true
  })
  const out: DiffLine[] = []
  lines.forEach((line, at) => {
    if (keep[at]) out.push(line)
    else if (keep[at - 1] && keep.indexOf(true, at) !== -1) out.push({ kind: ' ', text: '⋯' })
  })
  return out
}
