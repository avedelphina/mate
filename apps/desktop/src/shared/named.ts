/**
 * The file of a project that some words name, when they name exactly one. Agents write the same
 * file in more than one way: from the project, from the context, or by its name alone.
 * `files` are the paths of the project's files, from the project folder.
 */
export function fileNamed(words: string, project: string, files: string[]): string | null {
  const said = words.trim().replace(/^\.\//, '')
  const lead = `projects/${project}/`
  const path = said.startsWith(lead) ? said.slice(lead.length) : said
  if (files.includes(path)) return path
  const alike = files.filter((each) => each.split('/').pop() === path)
  return alike.length === 1 ? alike[0] : null
}
