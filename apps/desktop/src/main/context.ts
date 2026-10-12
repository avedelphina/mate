import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { insertComment, readDocument, type Thread } from '../shared/comments'

export type DocumentView = {
  project: string
  drafts: string[]
  /** Null while a project with several drafts waits for the reader to pick one. */
  file: string | null
  text: string
  comments: Thread[]
  intents: string
  principles: string
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

/** A path that stays inside root. Rejects absolute paths and anything that climbs out. */
export function resolveInside(root: string, ...parts: string[]): string {
  const target = path.resolve(root, ...parts)
  const relative = path.relative(root, target)
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return target
  throw new Error('That path leaves the context.')
}

export async function readProject(contextDir: string, project: string, file?: string): Promise<DocumentView> {
  const projectDir = resolveInside(contextDir, 'projects', project)
  const draftDir = path.join(projectDir, 'draft')
  const drafts = await listMarkdown(draftDir)
  if (drafts.length === 0) throw new Error('This project has no markdown draft.')
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
  return { project, drafts, file: chosen, ...document, intents, principles }
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
