import { runScript } from './scripts'

/**
 * The tools of a repository made from the security architecture template, run when the reader
 * presses a button: `tools/repo.py` makes a record and gives it its ID, `tools/build-docs.sh` builds
 * Word files. They run as a script of the project does (trusted context only, no agent, no shell),
 * and the line is made here from checked words, never taken from the window as it is.
 */

const KINDS = ['adr', 'review', 'reg', 'meeting']
const TYPES = ['finding', 'deviation', 'risk-acceptance', 'deadline']

/** A path as a plain relative path of the project: no climbing, nothing hidden, no quote or space that would split it. */
const plain = (value: string) => value.split('/').every((part) => /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(part) && part !== '..')

const failed = (output: string, fallback: string) => new Error(output.trim().split('\n').slice(-3).join(' ') || fallback)

/** A record made from its template, and the overviews in the folder READMEs made again. The path counts from the project. */
export async function newRecord(contextDir: string, project: string, kind: unknown, title: unknown, type: unknown): Promise<string> {
  if (typeof kind !== 'string' || !KINDS.includes(kind)) throw new Error('That is not a kind of record.')
  // The title is one argument. A quote would end it, and a dash first would be read as an option.
  const name = String(title ?? '').replace(/["\s]+/g, ' ').replace(/^[\s-]+/, '').trim().slice(0, 120)
  if (!name) throw new Error('Give the record a title.')
  if (kind === 'reg' && !TYPES.includes(String(type))) throw new Error('A register item needs a type.')
  const ran = await runScript(contextDir, project, `tools/repo.py new ${kind} "${name}"${kind === 'reg' ? ` --type ${type}` : ''}`, 60, 'tools')
  if (ran.code !== 0) throw failed(ran.output, 'The tool could not make the record.')
  const made = ran.output.trim().split('\n').pop()!.trim()
  if (!made.toLowerCase().endsWith('.md') || !plain(made)) throw new Error('The tool did not say where the record is.')
  // The overview tables list it now. A failure here leaves a record that is made, so it is not an error.
  await runScript(contextDir, project, 'tools/repo.py index', 60, 'tools').catch(() => null)
  return made
}

/** What `build-docs.sh` builds: all of it, a project of the repository, or one review. */
export function buildTarget(target: unknown): string {
  const word = String(target)
  if (word === '--all') return word
  if (!plain(word) || !(/^projects\/[^/]+$/.test(word) || /^reviews\/[^/]+\.md$/i.test(word))) throw new Error('Only a project or a review is built.')
  return word
}

/** Word files built from the Markdown. Where they are, from the project, and what the tool said. */
export async function buildDocuments(contextDir: string, project: string, target: unknown): Promise<{ built: string[]; output: string }> {
  const ran = await runScript(contextDir, project, `tools/build-docs.sh ${buildTarget(target)}`, 180, 'tools')
  if (ran.code !== 0) throw failed(ran.output, 'The documents could not be built.')
  const built = [...ran.output.matchAll(/^→ (\S.*\.docx)$/gm)].map((each) => each[1]).filter(plain)
  return { built, output: ran.output.trim() }
}
