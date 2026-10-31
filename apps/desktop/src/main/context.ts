import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { combine, insertComment, parseComments, readDocument, retype, separate, type Thread } from '../shared/comments'
import { asText, placeOf, type Place } from './contextIndex'
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
  /** Where the drafts are, from the project folder: `draft/`, or nothing when they are where they lie. */
  draftsIn: string
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

/** Whether `inner` is `outer` or lies in it. Both are real paths. */
const within = (outer: string, inner: string): boolean => {
  const relative = path.relative(outer, inner)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * Bring a folder in as a project of the context, as it is: often a repository the reader already
 * has. It is moved, not copied, to `projects/<its name>/`, and nothing in it is changed. Its git
 * history and its remote stay its own. Gives the name of the project.
 */
export async function importProject(contextDir: string, from: string): Promise<string> {
  const source = await realpath(String(from))
  const here = await realpath(contextDir)
  if (within(here, source)) throw new Error('That folder is in this context already.')
  if (within(source, here)) throw new Error('This context is inside that folder. It cannot be brought into itself.')
  if (!(await stat(source)).isDirectory()) throw new Error('Only a folder can be a project.')
  const name = path.basename(source)
  if (!NAME.test(name)) throw new Error('Rename the folder first: letters and numbers, then spaces, dots, dashes and underscores may follow.')
  await mkdir(path.join(contextDir, 'projects'), { recursive: true })
  // The projects folder must really be in the context: a link is not moved into.
  const target = path.join(await realInside(contextDir, 'projects'), name)
  if (existsSync(target)) throw new Error('A project of that name is already in this context.')
  try {
    await rename(source, target)
  } catch (failed) {
    if ((failed as NodeJS.ErrnoException).code === 'EXDEV') {
      throw new Error('That folder is on another disk than the context. Move it beside the context first, or copy it in Finder.')
    }
    throw failed
  }
  return name
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

/**
 * Where a project keeps its drafts. One made in Mate keeps them in its `draft/` folder. One with no
 * such folder, such as a repository brought in as it is, keeps them where they are: every markdown
 * file of it is a draft, but the two that steer it and its panes. Mate does not change its shape.
 */
export const draftHome = (projectDir: string): string => (existsSync(path.join(projectDir, 'draft')) ? path.join(projectDir, 'draft') : projectDir)

/** The drafts of a project, each named by its path from where the project keeps them. */
export async function draftsOf(projectDir: string): Promise<string[]> {
  const home = draftHome(projectDir)
  // The comments on a file that is not markdown are kept beside it. They are not a draft of their own.
  const beside = (name: string) => name.toLowerCase().endsWith('.comments.md') && existsSync(path.join(home, name.slice(0, -'.comments.md'.length)))
  if (home !== projectDir) return (await listMarkdown(home)).filter((each) => !beside(each))
  return (await listFiles(projectDir)).filter(
    (each) =>
      each.toLowerCase().endsWith('.md') && each !== 'intents.md' && each !== 'principles.md' && !each.startsWith('panes/') && !beside(each)
  )
}

// ponytail: a text file is read whole to be reviewed. Past this, it is a data file, not a document.
const MAX_TEXT_FILE = 2 * 1024 * 1024

/**
 * A file of the project that is text and not markdown, such as a CSV, an XML config or a log. It is
 * reviewed like a draft, named by its path in the project, and its comments are kept beside it in
 * NAME.comments.md, so the file itself changes only when the reader applies a suggestion or types
 * in it. Text is told by its bytes, not its name: UTF-8, and no zero byte.
 */
async function textFileAt(contextDir: string, project: string, file: string): Promise<{ full: string; side: string; relative: string } | null> {
  const name = String(file)
  if (name.toLowerCase().endsWith('.md') || isTwinned(name)) return null
  const parts = name.split('/')
  // A script is run from its card, not reviewed.
  if (parts.some((part) => part === '' || part.startsWith('.')) || parts[0] === 'scripts') return null
  const full = await realInside(contextDir, 'projects', project, ...parts).catch(() => null)
  const info = full ? await stat(full).catch(() => null) : null
  if (!full || !info?.isFile() || info.size > MAX_TEXT_FILE) return null
  if (asText(await readFile(full)) === null) return null
  return { full, side: `${full}.comments.md`, relative: `projects/${project}/${name}` }
}

/** A text file and the comments beside it, put together as a draft reads. */
async function readWithComments(text: { full: string; side: string }): Promise<string> {
  return combine(await readFile(text.full, 'utf8'), await readFile(text.side, 'utf8').catch(() => ''))
}

/** The place of a draft, checked: it must be one the project has. */
async function draftAt(contextDir: string, project: string, file: string): Promise<{ full: string; relative: string }> {
  const projectDir = resolveInside(contextDir, 'projects', project)
  if (!(await draftsOf(projectDir)).includes(file)) throw new Error('That draft is not in this project.')
  const full = path.join(draftHome(projectDir), file)
  return { full, relative: path.relative(contextDir, full).split(path.sep).join('/') }
}

/** Write a new draft where the project keeps its drafts. A file of that name is never written over. */
async function putDraft(contextDir: string, project: string, file: string, text: string | Buffer, clash: string): Promise<void> {
  const home = draftHome(resolveInside(contextDir, 'projects', project))
  await mkdir(home, { recursive: true })
  try {
    await writeFile(path.join(home, file), text, { flag: 'wx' })
  } catch {
    throw new Error(clash)
  }
  mateWrote(contextDir, path.relative(contextDir, path.join(home, file)).split(path.sep).join('/'), Buffer.from(text))
}

export async function readProject(contextDir: string, project: string, file?: string): Promise<DocumentView> {
  const projectDir = resolveInside(contextDir, 'projects', project)
  // A project with no draft still opens: its other files are there to be read.
  if (!existsSync(projectDir)) throw new Error('That project is not in this context.')
  const draftDir = draftHome(projectDir)
  const drafts = await draftsOf(projectDir)
  const text = file !== undefined && !drafts.includes(file) ? await textFileAt(contextDir, project, file) : null
  if (file !== undefined && !drafts.includes(file) && !text) throw new Error('That draft is not in this project.')
  // With several drafts the reader picks. Opening the first sorted name would be a guess.
  const chosen = file ?? (drafts.length === 1 ? drafts[0] : null)
  const document =
    chosen === null
      ? { text: '', comments: [] }
      : readDocument(text ? await readWithComments(text) : await readFile(path.join(draftDir, chosen), 'utf8'))
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
  const draftsIn = draftDir === projectDir ? '' : 'draft/'
  return { project, drafts, draftsIn, file: chosen, ...document, intents, principles, panes, files: await listFiles(projectDir) }
}

/** Read the draft, change it, and put it back whole. */
/** Write a file of the context by a temporary file and a rename, never in place. */
async function replace(contextDir: string, full: string, relative: string, text: string): Promise<void> {
  const temporary = path.join(path.dirname(full), `.${path.basename(full)}.${randomUUID()}.tmp`)
  await writeFile(temporary, text)
  await rename(temporary, full)
  mateWrote(contextDir, relative, Buffer.from(text))
}

export async function editDraft(
  contextDir: string,
  project: string,
  file: string,
  change: (markdown: string) => string
): Promise<DocumentView> {
  const projectDir = resolveInside(contextDir, 'projects', project)
  const text = (await draftsOf(projectDir)).includes(file) ? null : await textFileAt(contextDir, project, file)
  if (text) {
    const combined = await readWithComments(text)
    const next = change(combined)
    const { body, side } = separate(next, path.basename(text.full))
    // A comment changes only the file beside it. The file is written when what it says changed.
    if (readDocument(next).text !== readDocument(combined).text) await replace(contextDir, text.full, `${text.relative}`, body)
    if (parseComments(next).length > 0 || existsSync(text.side)) await replace(contextDir, text.side, `${text.relative}.comments.md`, side)
    return readProject(contextDir, project, file)
  }
  const { full: documentPath, relative } = await draftAt(contextDir, project, file)
  const next = change(await readFile(documentPath, 'utf8'))
  const temporary = path.join(path.dirname(documentPath), `.${path.basename(documentPath)}.${randomUUID()}.tmp`)
  await writeFile(temporary, next)
  await rename(temporary, documentPath)
  mateWrote(contextDir, relative, Buffer.from(next))
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
  await putDraft(contextDir, project, file, text, 'A draft of that name is already there.')
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

/**
 * Give a project's intents or principles the text the reader typed. They are the only files that
 * steer an agent, so only the reader's window asks for this and no agent has a way to. `base` is the
 * text the reader began from: a file that holds another text by now is not written over.
 */
export async function writeSteering(contextDir: string, project: string, name: string, base: string, text: string, draft?: string): Promise<DocumentView> {
  if (name !== 'intents' && name !== 'principles') throw new Error('Only the intents and the principles are written here.')
  const full = resolveInside(contextDir, 'projects', project, `${name}.md`)
  if ((await readFile(full, 'utf8').catch(() => null)) !== base) {
    throw new Error('The file has changed since you began to edit it. Nothing was saved. Copy what you typed, then edit again.')
  }
  // A text area gives LF. The file keeps the line endings it had.
  const eol = base.includes('\r\n') ? '\r\n' : '\n'
  await replace(contextDir, full, `projects/${project}/${name}.md`, text.replace(/\r?\n/g, eol))
  return readProject(contextDir, project, draft)
}

/** The documents of the shelf, by their path from the shelf folder. What is true now, for every project. */
export async function listShelf(contextDir: string): Promise<string[]> {
  const shelf = path.join(contextDir, 'shelf')
  if (!existsSync(shelf)) return []
  return (await listFiles(shelf)).filter((each) => each.toLowerCase().endsWith('.md') || isTwinned(each))
}

/**
 * The files of the context that are neither on the shelf nor in a project: its dropbox, and whatever
 * else lies in it. Hidden names are left out, and a link is not followed.
 */
export async function listContextFiles(contextDir: string): Promise<string[]> {
  return (await listFiles(contextDir)).filter((each) => !each.startsWith('projects/') && !each.startsWith('shelf/'))
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
  const raw = await readFile((await draftAt(contextDir, project, file)).full, 'utf8')
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
  await putDraft(contextDir, project, file, text, 'A draft of that name is already in this project. It was not written over.')
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
  await putDraft(contextDir, project, file, text, 'A draft of that name is already in this project. The file was left in the dropbox.')
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
  await putDraft(contextDir, project, file, text, 'A draft of that name is already in this project. It was not written over.')
  return readProject(contextDir, project, file)
}

/** The folders a project keeps for itself. A folder copied in does not take one of their names. */
const KEPT = new Set(['draft', 'dropbox', 'panes', 'scripts'])

/**
 * Copy a folder from outside the context into a project, as it is: all its files and folders, as
 * material of the project. The text twins and search by meaning then read it. The path is one the
 * reader chose in the file dialog of the system. Hidden files and links are left out: a link could
 * lead out of the context, and what is under a `.git` folder is never kept for an agent.
 */
export async function copyFolder(contextDir: string, project: string, source: string): Promise<string> {
  const from = path.isAbsolute(String(source)) ? await realpath(source).catch(() => '') : ''
  if (!from || !(await stat(from)).isDirectory()) throw new Error('That is not a folder on this computer.')
  const here = await realpath(contextDir)
  if (within(here, from)) throw new Error('That folder is in this context already.')
  if (within(from, here)) throw new Error('This context is inside that folder. It cannot be copied into itself.')
  const name = path.basename(from)
  if (name.startsWith('.')) throw new Error('That folder is hidden. Mate leaves hidden files out.')
  if (KEPT.has(name)) throw new Error(`Rename the folder first. A project keeps ${name}/ for itself.`)
  const target = path.join(await realInside(contextDir, 'projects', project), name)
  if (existsSync(target)) throw new Error('A file or folder of that name is already in this project.')
  await cp(from, target, {
    recursive: true,
    errorOnExist: true,
    force: false,
    filter: async (each) => {
      if (each !== from && path.basename(each).startsWith('.')) return false
      const info = await lstat(each)
      return info.isDirectory() || info.isFile()
    }
  })
  return `projects/${project}/${name}`
}
