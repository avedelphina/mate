import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { insertComment, readDocument, retype, type Thread } from '../shared/comments'
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

/**
 * Where a file of the context really is, for the system's file manager to show. Any kind of file,
 * since this is how the reader gets to one Mate cannot draw. Nothing hidden, and nothing outside.
 */
export async function placeOnDisk(contextDir: string, relative: string): Promise<string> {
  const parts = String(relative).split('/')
  if (parts.some((part) => part === '' || part.startsWith('.'))) throw new Error('That is not a file of this context.')
  return realInside(contextDir, ...parts)
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

/**
 * Give a draft the text the reader typed. `base` is the text the reader began from: when the file
 * holds another text by now, someone else has written it, and nothing is saved over that.
 */
export function writeDraft(contextDir: string, project: string, file: string, base: string, text: string): Promise<DocumentView> {
  return editDraft(contextDir, project, file, (markdown) => {
    if (readDocument(markdown).text !== base) {
      throw new Error('The file has changed since you began to edit it. Nothing was saved. Copy what you typed, then open the draft again.')
    }
    return retype(markdown, text)
  })
}

/** Start a new draft in a project: a file with its title and nothing else. An existing file is never written over. */
export async function createDraft(contextDir: string, project: string, name: string): Promise<DocumentView> {
  const title = String(name).trim().replace(/\.md$/i, '')
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,80}$/u.test(title)) {
    throw new Error('Name the draft with letters and numbers. Spaces, dots, dashes and underscores may follow.')
  }
  const projectDir = resolveInside(contextDir, 'projects', project)
  if (!existsSync(projectDir)) throw new Error('That project is not in this context.')
  const file = `${title}.md`
  const text = `# ${title}\n`
  await mkdir(path.join(projectDir, 'draft'), { recursive: true })
  try {
    await writeFile(path.join(projectDir, 'draft', file), text, { flag: 'wx' })
  } catch {
    throw new Error('A draft of that name is already there.')
  }
  mateWrote(contextDir, `projects/${project}/draft/${file}`, Buffer.from(text))
  return readProject(contextDir, project, file)
}

/**
 * Tick a task box in a pane, or clear it. `at` is where the box is in the text the reader was
 * shown, and `base` is that text: a pane an agent has written since is not changed. The one
 * character is all that changes in the file.
 */
export async function tickPane(contextDir: string, project: string, name: string, base: string, at: number, draft?: string): Promise<DocumentView> {
  const dir = path.join(resolveInside(contextDir, 'projects', project), 'panes')
  if (name.startsWith('.') || !(await listMarkdown(dir)).includes(name)) throw new Error('That pane is not in this project.')
  const raw = await readFile(path.join(dir, name), 'utf8')
  const text = readDocument(raw).text
  if (text !== base) throw new Error('The pane has changed since it was shown. Nothing was ticked.')
  // A box is `[ ]` or `[x]` at the start of a list item, and nothing else is.
  const box = text.slice(at, at + 3)
  const line = text.slice(text.lastIndexOf('\n', at - 1) + 1, at)
  if (!Number.isInteger(at) || !/^\[[ xX]\]$/.test(box) || !/^[\s>]*(?:[-*+]|\d+[.)])\s+$/.test(line)) throw new Error('That is not a task box.')
  const next = Buffer.from(retype(raw, text.slice(0, at + 1) + (box[1] === ' ' ? 'x' : ' ') + text.slice(at + 2)))
  const temporary = path.join(dir, `.${name}.${randomUUID()}.tmp`)
  await writeFile(temporary, next)
  await rename(temporary, path.join(dir, name))
  mateWrote(contextDir, `projects/${project}/panes/${name}`, next)
  return readProject(contextDir, project, draft)
}
