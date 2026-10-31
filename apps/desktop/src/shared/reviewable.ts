/**
 * Whether a markdown file of a project that is not a draft is open for review, with its comments
 * kept beside it as for any file of text. `path` is from the project folder. Not so: the intake
 * (`dropbox/`, whose files leave by an exit), the panes, the scripts, the two files that steer the
 * project, and what is kept beside a file (its comments and its note).
 */
export function reviewableMarkdown(path: string): boolean {
  const parts = path.replace(/^\//, '').split('/')
  if (!path.toLowerCase().endsWith('.md') || parts.some((part) => part === '' || part.startsWith('.'))) return false
  if (['dropbox', 'panes', 'scripts'].includes(parts[0])) return false
  if (parts.length === 1 && (parts[0] === 'intents.md' || parts[0] === 'principles.md')) return false
  return !/\.(comments|notes)\.md$/i.test(path)
}
