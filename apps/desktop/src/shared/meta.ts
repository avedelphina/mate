/**
 * Where the front matter of a document is: YAML between two `---` lines, the first thing in the file,
 * as Obsidian, GitHub, Jekyll and Pandoc read it. It is not markdown: read as markdown, its closing
 * line would underline a heading.
 */
export function metaOf(text: string): { from: number; to: number } | null {
  const first = /^---\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(text)
  return first ? { from: 0, to: first[0].length } : null
}
