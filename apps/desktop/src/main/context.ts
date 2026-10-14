import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { insertComment, readDocument, retype, type Thread } from '../shared/comments'
import { placeOf, type Place } from './contextIndex'
import { inRepository } from './git'
import { mateWrote } from './guard'
import { isTwinned, twinOf } from '../shared/twin'

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
/** `twin`: the text was taken out of a PDF or a Word file. The file itself is not shown. */
export type FileView = Place & { path: string; text: string; twin?: boolean }

export async function readContextFile(contextDir: string, relative: string): Promise<FileView> {
  const parts = relative.split('/')
  if (parts.some((part) => part === '' || part.startsWith('.'))) throw new Error('That is not a document of this context.')
  // A PDF or a Word file is read as its text twin. The file itself must be in the context.
  if (isTwinned(relative)) {
    await realInside(contextDir, ...parts)
    const text = await readFile(path.join(contextDir, twinOf(relative)), 'utf8').catch(() => null)
    if (text === null) throw new Error('Mate has not read the text of this file yet. Try again in a moment.')
    return { path: relative, ...placeOf(relative), text, twin: true }
  }
  if (!relative.toLowerCase().endsWith('.md')) throw new Error('That is not a document of this context.')
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

/** A name the reader gives a draft or a project. It is a file name, so nothing that could be a path. */
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,80}$/u

/** What the window is told of a context: where it is, its projects, and what it still lacks. */
export type Opened = {
  dir: string
  projects: string[]
  /** It has a folder for projects. Any folder can be opened, and one without is not a context yet. */
  shaped: boolean
  /** It is in a git repository: its own, or one of a folder above it. */
  tracked: boolean
}

export async function describeContext(dir: string): Promise<Opened> {
  return { dir, projects: await listProjects(dir), shaped: existsSync(path.join(dir, 'projects')), tracked: inRepository(dir) }
}

const SHAPE = ['shelf', 'dropbox', 'projects']

/**
 * Start a context in a folder that is not there yet: a shelf, a dropbox and the projects, all
 * empty. A folder that is there is never made over. It is opened, as any folder can be.
 */
export async function createContext(dir: string): Promise<void> {
  try {
    await mkdir(dir)
  } catch {
    throw new Error('Something of that name is already there. Open it instead.')
  }
  await shapeContext(dir)
}

/** Give a folder that is there the shape of a context. What is in it stays as it is. */
export async function shapeContext(dir: string): Promise<void> {
  for (const each of SHAPE) await mkdir(path.join(dir, each), { recursive: true })
}

/** Whether two paths are one folder: a name changed only in its capitals is the same folder on a Mac. */
const sameFolder = (a: string, b: string) => {
  try {
    const [one, two] = [statSync(a), statSync(b)]
    return one.dev === two.dev && one.ino === two.ino
  } catch {
    return false
  }
}

/**
 * Give a context a new name, where it is. Its folder is renamed, and all that is in it goes with it:
 * projects, sessions, the helpers. Gives the folder as it is now called.
 */
export async function renameContext(contextDir: string, name: string): Promise<string> {
  const title = String(name).trim()
  if (!NAME.test(title)) throw new Error('Name the context with letters and numbers. Spaces, dots, dashes and underscores may follow.')
  const to = path.join(path.dirname(contextDir), title)
  if (to === contextDir) return contextDir
  if (existsSync(to) && !sameFolder(to, contextDir)) throw new Error('Something of that name is already there.')
  await rename(contextDir, to)
  return to
}

/**
 * Give a project of the context a new name. Its folder is renamed, and the text twins of its files
 * go with it, so nothing is read again. Its sessions are moved by `moveSessions`. Gives the new name.
 */
export async function renameProject(contextDir: string, from: string, name: string): Promise<string> {
  const title = String(name).trim()
  if (!NAME.test(title)) throw new Error('Name the project with letters and numbers. Spaces, dots, dashes and underscores may follow.')
  if (!(await listProjects(contextDir)).includes(from)) throw new Error('That project is not in this context.')
  if (title === from) return from
  const projects = await realInside(contextDir, 'projects')
  if (existsSync(path.join(projects, title)) && !sameFolder(path.join(projects, title), path.join(projects, from))) {
    throw new Error('A project of that name is already there.')
  }
  await rename(path.join(projects, from), path.join(projects, title))
  const twins = path.join(contextDir, '.indexes', 'text', 'projects')
  if (existsSync(path.join(twins, from))) await rename(path.join(twins, from), path.join(twins, title)).catch(() => {})
  return title
}

/** What a new project starts with. The two files steer it, and say only what they are for. */
const STARTS = [
  ['intents.md', '# Intents\n\nWhich way this project leans. An intent is never finished.\n'],
  ['principles.md', '# Principles\n\nThe rules of engagement for this project. They are not traded away to finish faster.\n']
]

/** Start a project in the context: its folder, a place for its drafts, and the two files that steer it. */
export async function createProject(contextDir: string, name: string): Promise<string> {
  const title = String(name).trim()
  if (!NAME.test(title)) throw new Error('Name the project with letters and numbers. Spaces, dots, dashes and underscores may follow.')
  await mkdir(path.join(contextDir, 'projects'), { recursive: true })
  // A projects folder that is a link to somewhere else is not written into.
  const dir = path.join(await realInside(contextDir, 'projects'), title)
  try {
    await mkdir(dir)
  } catch {
    throw new Error('A project of that name is already there.')
  }
  await mkdir(path.join(dir, 'draft'))
  for (const [file, text] of STARTS) {
    await writeFile(path.join(dir, file), text, { flag: 'wx' })
    // An agent may be working in the context. These are not its files.
    mateWrote(contextDir, `projects/${title}/${file}`, Buffer.from(text))
  }
  return title
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
  if (!NAME.test(title)) throw new Error('Name the draft with letters and numbers. Spaces, dots, dashes and underscores may follow.')
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

/** The documents of the shelf, by their path from the shelf folder. What is true now, for every project. */
export async function listShelf(contextDir: string): Promise<string[]> {
  const shelf = path.join(contextDir, 'shelf')
  if (!existsSync(shelf)) return []
  return (await listFiles(shelf)).filter((each) => each.toLowerCase().endsWith('.md') || isTwinned(each))
}

/** Where a name puts a document on the shelf, from the context folder. It throws on a name that is not one. */
export const shelfPath = (name: string) => ['shelf', ...shelfName(name)].join('/')

/** A name on the shelf, as its parts. Folders may be named. Nothing hidden, and nothing that climbs out. */
function shelfName(name: string): string[] {
  const parts = String(name).trim().replace(/\.md$/i, '').split('/')
  if (parts.some((part) => !/^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,80}$/u.test(part))) {
    throw new Error('Name the shelf document with letters and numbers. Spaces, dots, dashes and underscores may follow, and a folder before a slash.')
  }
  parts[parts.length - 1] += '.md'
  return parts
}

/**
 * Publish a draft: its text becomes the named document on the shelf, which every project reads as
 * what is true now. Only the reader does this. Saving a draft never does, and no agent can.
 *
 * The comments are not published: the shelf gets the text the page shows. The draft is not changed,
 * and is a proposal again. A document that was on the shelf under that name is kept beside it, in
 * `shelf/.history/`, as what was true before. It is hidden there, so nothing reads it as current.
 */
export async function publish(contextDir: string, project: string, file: string, name: string): Promise<{ path: string; replaced: boolean }> {
  const draftDir = path.join(resolveInside(contextDir, 'projects', project), 'draft')
  if (!(await listMarkdown(draftDir)).includes(file)) throw new Error('That draft is not in this project.')
  const raw = await readFile(path.join(draftDir, file), 'utf8')
  const text = Buffer.from(readDocument(raw).text.replace(/\n/g, raw.includes('\r\n') ? '\r\n' : '\n'))
  const parts = shelfName(name)
  const relative = ['shelf', ...parts].join('/')

  // The folder the document goes into is made, and must really be inside the context: a link is not written through.
  await mkdir(resolveInside(contextDir, 'shelf', ...parts.slice(0, -1)), { recursive: true })
  const dir = await realInside(contextDir, 'shelf', ...parts.slice(0, -1))
  const target = path.join(dir, parts[parts.length - 1])
  const there = await lstat(target).catch(() => null)
  if (there && !there.isFile()) throw new Error('That name on the shelf is not a document. Nothing was published.')

  if (there) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const kept = ['shelf', '.history', parts.join('__'), `${stamp}.md`]
    await mkdir(resolveInside(contextDir, ...kept.slice(0, -1)), { recursive: true })
    const before = await readFile(target)
    await writeFile(path.join(await realInside(contextDir, ...kept.slice(0, -1)), kept[kept.length - 1]), before, { flag: 'wx' })
    mateWrote(contextDir, kept.join('/'), before)
  }
  const temporary = path.join(dir, `.${parts[parts.length - 1]}.${randomUUID()}.tmp`)
  await writeFile(temporary, text)
  await rename(temporary, target)
  mateWrote(contextDir, relative, text)
  return { path: relative, replaced: there !== null }
}

/**
 * Take a document of the shelf down into a project, to work on. It is a copy the project owns:
 * the shelf keeps its own, and stays what is true until the copy is published back.
 */
export async function takeDown(contextDir: string, project: string, relative: string): Promise<DocumentView> {
  const parts = String(relative).split('/')
  if (parts[0] !== 'shelf' || parts.length < 2) throw new Error('Only a document of the shelf is taken down this way.')
  const text = await readFile(await placeOnDisk(contextDir, relative))
  if (!relative.toLowerCase().endsWith('.md')) throw new Error('That is not a document of this context.')
  const projectDir = resolveInside(contextDir, 'projects', project)
  if (!existsSync(projectDir)) throw new Error('That project is not in this context.')
  const file = parts[parts.length - 1]
  await mkdir(path.join(projectDir, 'draft'), { recursive: true })
  try {
    await writeFile(path.join(projectDir, 'draft', file), text, { flag: 'wx' })
  } catch {
    throw new Error('A draft of that name is already in this project. It was not written over.')
  }
  mateWrote(contextDir, `projects/${project}/draft/${file}`, text)
  return readProject(contextDir, project, file)
}

/** Whether a file lies in a dropbox this project may pull from: its own, or the one of the whole context. */
export const inDropbox = (project: string, relative: string) =>
  relative.startsWith('dropbox/') || relative.startsWith(`projects/${project}/dropbox/`)

/**
 * Pull a document out of a dropbox into the project's drafts. It is one of the exits of a dropbox:
 * the file leaves it, and is from then on a draft the project works on. A draft of that name is
 * never written over.
 */
export async function pullIn(contextDir: string, project: string, relative: string): Promise<DocumentView> {
  if (!inDropbox(project, String(relative))) throw new Error('Only a file of a dropbox is pulled in this way.')
  if (!relative.toLowerCase().endsWith('.md')) throw new Error('That is not a document Mate can open as a draft.')
  if (relative.endsWith('.source.md')) throw new Error('That is a note about a file that was left outside. It stays in the dropbox.')
  const source = await placeOnDisk(contextDir, relative)
  const projectDir = resolveInside(contextDir, 'projects', project)
  if (!existsSync(projectDir)) throw new Error('That project is not in this context.')
  const file = relative.split('/').pop()!
  const text = await readFile(source)
  await mkdir(path.join(projectDir, 'draft'), { recursive: true })
  try {
    await writeFile(path.join(projectDir, 'draft', file), text, { flag: 'wx' })
  } catch {
    throw new Error('A draft of that name is already in this project. The file was left in the dropbox.')
  }
  mateWrote(contextDir, `projects/${project}/draft/${file}`, text)
  // It has left the dropbox only once the draft is written.
  await rm(source)
  mateWrote(contextDir, relative, null)
  return readProject(contextDir, project, file)
}

const sized = (bytes: number) => (bytes < 1024 ? `${bytes} bytes` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)

/**
 * Note a file that is not in the context: where it lies on this computer, and nothing of what is
 * in it. It is one of the exits of a dropbox. The file stays outside, and the context knows of it:
 * the note is a document, so a search finds it and an agent is told of it.
 */
export async function noteSource(contextDir: string, project: string, source: string): Promise<string> {
  const info = path.isAbsolute(String(source)) ? await stat(source).catch(() => null) : null
  const name = path.basename(String(source)).replace(/^\.+/, '')
  if (!info?.isFile() || !name) throw new Error('That is not a file on this computer.')
  const projectDir = resolveInside(contextDir, 'projects', project)
  if (!existsSync(projectDir)) throw new Error('That project is not in this context.')
  const note = `${name}.source.md`
  const day = (date: Date) => date.toISOString().slice(0, 10)
  const text = Buffer.from(
    [
      `# ${name}`,
      '',
      'This file is not in the context. It was left where it lies, on this computer:',
      '',
      `\`${source}\``,
      '',
      `${sized(info.size)}, last changed ${day(info.mtime)}. Noted ${day(new Date())}.`,
      ''
    ].join('\n')
  )
  await mkdir(path.join(projectDir, 'dropbox'), { recursive: true })
  try {
    await writeFile(path.join(projectDir, 'dropbox', note), text, { flag: 'wx' })
  } catch {
    throw new Error('That file is already noted in this dropbox.')
  }
  const relative = `projects/${project}/dropbox/${note}`
  mateWrote(contextDir, relative, text)
  return relative
}

/**
 * Copy a document from outside the context into a project's drafts. The path is one the reader
 * chose in the file dialog of the system, never one the window made up.
 */
export async function copySource(contextDir: string, project: string, source: string): Promise<DocumentView> {
  const file = path.basename(String(source)).replace(/^\.+/, '')
  if (!path.isAbsolute(String(source)) || !file.toLowerCase().endsWith('.md')) throw new Error('That is not a document Mate can open as a draft.')
  const projectDir = resolveInside(contextDir, 'projects', project)
  if (!existsSync(projectDir)) throw new Error('That project is not in this context.')
  const text = await readFile(source)
  await mkdir(path.join(projectDir, 'draft'), { recursive: true })
  try {
    await writeFile(path.join(projectDir, 'draft', file), text, { flag: 'wx' })
  } catch {
    throw new Error('A draft of that name is already in this project. It was not written over.')
  }
  mateWrote(contextDir, `projects/${project}/draft/${file}`, text)
  return readProject(contextDir, project, file)
}
