import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { insertComment, parseComments, type ReviewComment } from '../shared/comments'

export type DocumentView = {
  project: string
  file: string
  markdown: string
  comments: ReviewComment[]
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
  const files = await listMarkdown(draftDir)
  if (files.length === 0) throw new Error('This project has no markdown draft.')
  const chosen = file && files.includes(file) ? file : files[0]
  const documentPath = resolveInside(draftDir, chosen)
  const markdown = await readFile(documentPath, 'utf8')
  const intents = existsSync(path.join(projectDir, 'intents.md'))
    ? await readFile(path.join(projectDir, 'intents.md'), 'utf8')
    : ''
  const principles = existsSync(path.join(projectDir, 'principles.md'))
    ? await readFile(path.join(projectDir, 'principles.md'), 'utf8')
    : ''
  return {
    project,
    file: chosen,
    markdown,
    comments: parseComments(markdown),
    intents,
    principles
  }
}

export async function addComment(
  contextDir: string,
  project: string,
  file: string,
  anchor: string,
  text: string,
  author: string
): Promise<DocumentView> {
  const documentPath = resolveInside(contextDir, 'projects', project, 'draft', file)
  const current = await readFile(documentPath, 'utf8')
  const next = insertComment(current, anchor, text, author)
  const temporary = path.join(path.dirname(documentPath), `.${path.basename(documentPath)}.${randomUUID()}.tmp`)
  await writeFile(temporary, next)
  await rename(temporary, documentPath)
  return readProject(contextDir, project, file)
}
