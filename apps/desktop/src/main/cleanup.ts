import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseComments, setCommentPrivate } from '../shared/comments'
import { commentsOf, draftHome, draftsOf, editDraft, listProjects, resolveInside } from './context'

/**
 * What older versions left in the projects, and what the reader may want out of them. Mate keeps its own
 * files in the context, so a project, a repository above all, holds only what the reader brought.
 */
export type Leftovers = {
  /** A file of comments beside the file they belong to: the project's path to the file. */
  sidecars: { project: string; file: string }[]
  /** In a project that is a repository of its own: the drafts that hold comments written into the file, named as the project lists them. */
  written: { project: string; file: string; comments: number }[]
}

async function walk(dir: string, base = ''): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(path.join(dir, base), { withFileTypes: true }).catch(() => [])) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const relative = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) found.push(...(await walk(dir, relative)))
    else if (entry.isFile()) found.push(relative)
  }
  return found
}

const SIDE = '.comments.md'

/** Once it has run, or found nothing to do, the context is not asked again. The mark is in the context, so no other computer asks either. */
const DONE = ['.mate', 'cleaned']

/**
 * Whether to offer the clean-up: this is a one-off for contexts made with an older version. Names only, so it costs
 * nothing on a folder kept in the cloud. A repository is offered even when it holds no comment: reading its drafts waits for the reader's yes.
 */
export async function offered(contextDir: string): Promise<boolean> {
  if (existsSync(path.join(contextDir, ...DONE))) return false
  const projects = await listProjects(contextDir)
  // The cheap look first: walking every folder of a project is slow where the files are kept in the cloud.
  if (projects.some((project) => existsSync(path.join(contextDir, 'projects', project, '.git')))) return true
  return (await leftovers(contextDir, false)).sidecars.length > 0
}

export async function markDone(contextDir: string): Promise<void> {
  await mkdir(path.join(contextDir, DONE[0]), { recursive: true })
  await writeFile(path.join(contextDir, ...DONE), 'The projects of this context were cleaned of what older versions of Mate left in them.\n')
}

/**
 * Looks for leftovers. Without `deep` only names are looked at, which costs nothing even on a folder kept
 * in the cloud. With it, the drafts of a repository are read to count the comments written in them.
 */
export async function leftovers(contextDir: string, deep: boolean): Promise<Leftovers> {
  const found: Leftovers = { sidecars: [], written: [] }
  for (const project of await listProjects(contextDir)) {
    const projectDir = resolveInside(contextDir, 'projects', project)
    const names = await walk(projectDir)
    const has = new Set(names)
    for (const file of names) {
      if (file.endsWith(SIDE) && has.has(file.slice(0, -SIDE.length))) found.sidecars.push({ project, file: file.slice(0, -SIDE.length) })
    }
    if (!deep || !existsSync(path.join(projectDir, '.git'))) continue
    const home = draftHome(projectDir)
    for (const draft of await draftsOf(projectDir)) {
      const raw = await readFile(path.join(home, draft), 'utf8').catch(() => '')
      const comments = parseComments(raw).filter((comment) => !comment.private).length
      if (comments > 0) found.written.push({ project, file: draft, comments })
    }
  }
  return found
}

/**
 * Take the leftovers out of the projects. A file of comments is moved into the context, and a comment
 * written in the file of a repository is taken out of it and kept there. Nothing is lost: the text of
 * every comment is in the context afterwards. Returns what was done, and what was left because the
 * context already holds comments for that file.
 */
export async function cleanUp(contextDir: string, found: Leftovers): Promise<{ moved: number; taken: number; left: number }> {
  let [moved, taken, left] = [0, 0, 0]
  for (const { project, file } of found.sidecars) {
    const from = path.join(resolveInside(contextDir, 'projects', project), `${file}${SIDE}`)
    const { side } = commentsOf(contextDir, project, file)
    if (existsSync(side)) {
      left += 1
      continue
    }
    await mkdir(path.dirname(side), { recursive: true })
    // The context may be on another disk than a repository brought in: copy, then remove, when a rename cannot.
    await rename(from, side).catch(async () => {
      await copyFile(from, side)
      await rm(from)
    })
    moved += 1
  }
  for (const { project, file, comments } of found.written) {
    await editDraft(contextDir, project, file, (markdown) =>
      parseComments(markdown).reduce((text, comment) => (comment.private ? text : setCommentPrivate(text, comment.id, true)), markdown)
    )
    taken += comments
  }
  return { moved, taken, left }
}
