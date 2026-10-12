import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { insertComment, readDocument, type Thread } from '../shared/comments'
import { placeOf, type Place } from './contextIndex'
import { mateWrote } from './guard'

/**
 * A file in a project's `panes/` folder. An agent writes it to show the reader something beside
 * the draft: tasks, deadlines, mail. `written` is when the file last changed, so the reader can
 * tell how old it is.
 */
export type Pane = { name: string; text: string; written: number }

export type DocumentView = {
  project: string
  drafts: string[]
  /** Null while a project with several drafts waits for the reader to pick one. */
  file: string | null
  text: string
  comments: Thread[]
  intents: string
  principles: string
  panes: Pane[]
  /** Every file of the project, by its path from the project folder. The window draws them as a tree. */
  files: string[]
}

/** A file of the context that is not under review here: the shelf, a project's intents. Shown, never written. */
export type FileView = Place & { path: string; text: string }

export async function readContextFile(contextDir: string, relative: string): Promise<FileView> {
  const parts = relative.split('/')
  if (!relative.toLowerCase().endsWith('.md') || parts.some((part) => part.startsWith('.'))) {
    throw new Error('That is not a document of this context.')
  }
  const raw = await readFile(await realInside(contextDir, ...parts), 'utf8')
  return { path: relative, ...placeOf(relative), text: readDocument(raw).text }
}

async function listDirs(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return []
  const entries = await readdir(dir, { withFileTypes: true })
  return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).map((entry) => entry.name).sort()
}

export async function listProjects(contextDir: string): Promise<string[]> {
  return listDirs(path.join(contextDir, 'projects'))
}

async function listMarkdown(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return []
  const entries = await readdir(dir, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .map((entry) => entry.name)
    .sort()
}

/**
 * Every file under a folder, by its path from that folder. Hidden names are left out, and a link
 * is not followed, so nothing is listed that is not in the folder itself.
 */
// ponytail: every name is sent each time the project is read. Past some thousands of files,
// send a folder when the reader unfolds it.
async function listFiles(dir: string, base = ''): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(path.join(dir, base), { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const relative = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) found.push(...(await listFiles(dir, relative)))
    else if (entry.isFile()) found.push(relative)
  }
  return found.sort()
}

/** A path that stays inside root. Rejects absolute paths and anything that climbs out. */
export function resolveInside(root: string, ...parts: string[]): string {
  const target = path.resolve(root, ...parts)
  const relative = path.relative(root, target)
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return target
  throw new Error('That path leaves the context.')
}

/**
 * The real place of a file of the context, every link followed. A link may point anywhere
 * inside the context and still read; what it points at must never be outside.
 */
export async function realInside(contextDir: string, ...parts: string[]): Promise<string> {
  const target = await realpath(resolveInside(contextDir, ...parts))
  const out = path.relative(await realpath(contextDir), target)
  if (out === '' || (!out.startsWith('..') && !path.isAbsolute(out))) return target
  throw new Error('That path leaves the context.')
}

export async function readProject(contextDir: string, project: string, file?: string): Promise<DocumentView> {
  const projectDir = resolveInside(contextDir, 'projects', project)
  const draftDir = path.join(projectDir, 'draft')
  // A project with no draft still opens: its other files are there to be read.
  if (!existsSync(projectDir)) throw new Error('That project is not in this context.')
  const drafts = await listMarkdown(draftDir)
  if (file !== undefined && !drafts.includes(file)) throw new Error('That draft is not in this project.')
  // With several drafts the reader picks. Opening the first sorted name would be a guess.
  const chosen = file ?? (drafts.length === 1 ? drafts[0] : null)
  const document =
    chosen === null ? { text: '', comments: [] } : readDocument(await readFile(path.join(draftDir, chosen), 'utf8'))
  const intents = existsSync(path.join(projectDir, 'intents.md'))
    ? await readFile(path.join(projectDir, 'intents.md'), 'utf8')
    : ''
  const principles = existsSync(path.join(projectDir, 'principles.md'))
    ? await readFile(path.join(projectDir, 'principles.md'), 'utf8')
    : ''
  // A pane is read like any file that is not reviewed, so it passes the same path check.
  const names = (await listMarkdown(path.join(projectDir, 'panes'))).filter((name) => !name.startsWith('.'))
  const panes = await Promise.all(
    names.map(async (name) => ({
      name,
      text: (await readContextFile(contextDir, `projects/${project}/panes/${name}`)).text,
      written: (await stat(path.join(projectDir, 'panes', name))).mtimeMs
    }))
  )
  return { project, drafts, file: chosen, ...document, intents, principles, panes, files: await listFiles(projectDir) }
}

/** Read the draft, change it, and put it back whole. */
export async function editDraft(
  contextDir: string,
  project: string,
  file: string,
  change: (markdown: string) => string
): Promise<DocumentView> {
  const draftDir = path.join(resolveInside(contextDir, 'projects', project), 'draft')
  if (!(await listMarkdown(draftDir)).includes(file)) throw new Error('That draft is not in this project.')
  const documentPath = path.join(draftDir, file)
  const next = change(await readFile(documentPath, 'utf8'))
  const temporary = path.join(draftDir, `.${file}.${randomUUID()}.tmp`)
  await writeFile(temporary, next)
  await rename(temporary, documentPath)
  mateWrote(contextDir, `projects/${project}/draft/${file}`, Buffer.from(next))
  return readProject(contextDir, project, file)
}

export function addComment(
  contextDir: string,
  project: string,
  file: string,
  anchor: string,
  text: string,
  author: string,
  from?: number,
  suggestion?: string
): Promise<DocumentView> {
  return editDraft(contextDir, project, file, (markdown) =>
    insertComment(markdown, anchor, text, author, from, suggestion)
  )
}
