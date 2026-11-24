/**
 * Links between documents, written as Obsidian writes them: `[[name]]`, `[[name|shown words]]` and
 * `[[name#Heading]]`. They are plain text in the file, so a person writes them and an agent can too.
 * Nothing keeps them: what links here is found by reading the documents again.
 */
export type WikiLink = { start: number; end: number; target: string; heading: string; alias: string }

/** `![[x]]` embeds a file in Obsidian, and is not a link. */
const LINK = /(?<!!)\[\[([^[\]\n|#]+?)(?:#([^[\]\n|]*))?(?:\|([^[\]\n]*))?\]\]/g

export function wikiLinks(text: string): WikiLink[] {
  return [...text.matchAll(LINK)].filter((found) => found[1].trim() !== '').map((found) => ({
    start: found.index,
    end: found.index + found[0].length,
    target: found[1].trim(),
    heading: (found[2] ?? '').trim(),
    alias: (found[3] ?? '').trim()
  }))
}

const clean = (words: string) => words.trim().replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase()
const EXTENSION = /\.[a-z0-9]{1,5}$/

/**
 * The file a name means, from the paths of the context (`shelf/…`, `projects/NAME/…`): the one whose
 * name or end of path is the name, as Obsidian takes the shortest match. A name with no extension is a
 * markdown note, and one with an extension (`policy.pdf`) is the file of that name. A file of the
 * project the link is in comes before the shelf, and the shelf before other places. Two files that
 * match equally are no answer: null, so a link never goes to a guess.
 */
export function resolveWiki(target: string, project: string | null, paths: string[]): string | null {
  const wanted = clean(target)
  if (!wanted) return null
  const find = (name: string, markdown: boolean) => {
    const found = paths.filter((path) => {
      const lower = path.toLowerCase()
      const bare = markdown ? lower.replace(/\.md$/, '') : lower
      return (!markdown || lower.endsWith('.md')) && (bare === name || bare.endsWith(`/${name}`))
    })
    for (const tier of [(path: string) => project !== null && path.startsWith(`projects/${project}/`), (path: string) => path.startsWith('shelf/'), () => true]) {
      const here = found.filter(tier)
      if (here.length > 0) return here.length === 1 ? here[0] : null
    }
    return null
  }
  if (EXTENSION.test(wanted) && !wanted.endsWith('.md')) {
    const exact = find(wanted, false)
    if (exact) return exact
  }
  return find(wanted.replace(/\.md$/, ''), true)
}

/**
 * The shortest name that still means `path` among `paths`: its own name, then more of its folders, then
 * the whole path. A markdown file is named without `.md`, as a link writes it, unless `extension` says to keep it.
 */
export function nameFor(path: string, project: string | null, paths: string[], extension = false): string {
  const parts = path.split('/')
  const strip = (name: string) => (extension ? name : name.replace(/\.md$/i, ''))
  for (let from = parts.length - 1; from >= 0; from--) {
    const name = strip(parts.slice(from).join('/'))
    if (resolveWiki(name, project, paths) === path) return name
  }
  return strip(path)
}

/**
 * The text with every link that meant `oldPath` made to mean `newPath`, its heading and its shown words
 * kept. `before` and `after` are the paths of the context before the file moved and after it. A link that
 * meant another file is not touched.
 */
export function relink(text: string, project: string | null, before: string[], after: string[], oldPath: string, newPath: string): string {
  let next = text
  for (const link of wikiLinks(text).reverse()) {
    if (resolveWiki(link.target, project, before) !== oldPath) continue
    const target = nameFor(newPath, project, after, /\.md$/i.test(link.target))
    next = `${next.slice(0, link.start)}[[${target}${link.heading ? `#${link.heading}` : ''}${link.alias ? `|${link.alias}` : ''}]]${next.slice(link.end)}`
  }
  return next
}
