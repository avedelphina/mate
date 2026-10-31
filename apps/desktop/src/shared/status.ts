// The same front matter that the page draws apart from the markdown.
const META = /^---\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/

/**
 * What a document says of itself in its front matter: `status: final`, lower case, or null. A
 * document that is final is its project's finished result. It is not the context's truth: only the
 * shelf is that.
 */
export function statusOf(text: string): string | null {
  const meta = META.exec(text)
  if (!meta) return null
  for (const line of meta[0].split('\n').slice(1)) {
    const found = /^status[ \t]*:[ \t]*(.+?)[ \t\r]*$/i.exec(line)
    if (found) return found[1].replace(/^["']|["']$/g, '').trim().toLowerCase() || null
  }
  return null
}
