/** A tag a document names in its front matter, and where it is written in the text. */
export type Tag = { tag: string; at: number; length: number }

// The same front matter that the page draws apart from the markdown.
const META = /^---\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/

/** A tag as a #tag in a comment is written: letters, numbers, dash and underscore. A slash nests it: `work/clients`. */
function clean(raw: string): string {
  return raw
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/^#/, '')
    .trim()
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_/-]/gu, '')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '')
}

/** Whether a document that names `tag` is found by `#wanted`: the tag itself, or one nested under it. Both folded. */
export const under = (tag: string, wanted: string): boolean => tag === wanted || tag.startsWith(`${wanted}/`)

/**
 * The files put under their tags, as a tree of folders draws them: `tag/nested/name.md`, a file under
 * every tag it names. Maps what is shown to the file, by its path from the project. A tag is spelled
 * as it is first met, so `Work` and `work` are one folder.
 */
export function tagPaths(tagged: Record<string, string[]>): Map<string, string> {
  const spelled = new Map<string, string>()
  const spell = (tag: string) =>
    tag
      .split('/')
      .map((part, at, parts) => {
        const key = parts.slice(0, at + 1).join('/').toLowerCase()
        if (!spelled.has(key)) spelled.set(key, part)
        return spelled.get(key)!
      })
      .join('/')
  const shown = new Map<string, string>()
  for (const [file, tags] of Object.entries(tagged).sort(([a], [b]) => a.localeCompare(b))) {
    for (const tag of new Set(tags.map(spell))) {
      const name = `${tag}/${file.split('/').pop()}`
      // Two files of one name under one tag: the second is told by its folders.
      shown.set(shown.has(name) ? `${tag}/${file.replaceAll('/', ' › ')}` : name, file)
    }
  }
  return shown
}

/**
 * The tags in the front matter of a document: `tags: a, b`, `tags: [a, b]`, or a list under `tags:`.
 * They are text in the file, so a person writes them and an agent can too. Nothing else keeps them.
 */
export function tagsOf(text: string): Tag[] {
  const meta = META.exec(text)
  if (!meta) return []
  const found: Tag[] = []
  const add = (raw: string, at: number) => {
    const tag = clean(raw)
    if (tag) found.push({ tag, at: at + raw.indexOf(raw.trim()), length: raw.trim().length })
  }
  const lines = meta[0].split('\n')
  let at = 0
  let listing = false
  for (const line of lines.slice(1)) {
    const start = at + lines[0].length + 1
    at += line.length + 1
    const key = /^tags[ \t]*:(.*)$/i.exec(line)
    if (key) {
      listing = key[1].trim() === ''
      const rest = key[1]
      const base = start + line.length - rest.length
      let from = 0
      for (const item of rest.replace(/[[\]]/g, ' ').split(',')) {
        add(item, base + from)
        from += item.length + 1
      }
      continue
    }
    const item = listing ? /^([ \t]*-[ \t]+)(.+?)[ \t\r]*$/.exec(line) : null
    if (item) add(item[2], start + item[1].length)
    else if (line.trim() !== '' && !/^[ \t]*#/.test(line)) listing = false
  }
  return found
}
