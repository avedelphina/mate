import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, safeStorage, shell, type IpcMainInvokeEvent } from 'electron'
import { endpointView, judgeOnEndpoint, keepEndpointIn, setEndpoint, stopRelay } from './endpoint'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { addReply, anchorComment, applySuggestion } from '../shared/comments'
import { agentEnvironment, listAgents } from './agents'
import { checkAssist, runAssist, type AssistTask } from './assist'
import { commitContext, inRepository, startRepository, uncommitted } from './git'
import { forgetMeaning, meaningMissing, moveMeaning, ollamaEmbed, refreshMeaning, searchMeaning } from './meaning'
import { refreshTwins } from './twins'
import {
  addComment,
  copyFolder,
  copySource,
  createContext,
  createDraft,
  createProject,
  importProject,
  renameContext,
  renameProject,
  describeContext,
  editDraft,
  listContextFiles,
  listShelf,
  noteSource,
  placeOnDisk,
  publish,
  pullIn,
  readContextFile,
  readProject,
  shapeContext,
  shelfPath,
  takeDown,
  tickPane,
  writeDraft
} from './context'
import { refreshIndex, searchIndex, type Hit } from './contextIndex'
import { startMcp, type Binding } from './mcp'
import { runScript, stopAllScripts, stopScript } from './scripts'
import { approve, describe, instructionFiles, keepPinsIn, movePins, unapproved } from './pins'
import {
  PRIVATE,
  closeAllToEndpoint,
  isOpenedToEndpoint,
  isPrivate,
  isTrusted,
  keepOpenedIn,
  keepPrivacyIn,
  keepTrustIn,
  moveOpened,
  movePrivacy,
  moveTrust,
  privacyAllows,
  privacyRefusal,
  setOpenedToEndpoint,
  setPrivate,
  setTrusted
} from './trust'
import {
  answerAsk,
  attend,
  compare,
  gate,
  closeAgentsIn,
  doors,
  moveSessions,
  isBusy,
  listModels,
  listSessions,
  revertChange,
  sendMessage,
  settleHeld,
  startSession,
  stopAllTurns,
  stopTurn,
  tuneSession,
  whenIdle,
  working,
  type Invited,
  type Session
} from './sessions'

// The name in the menu bar, and of the folder the app keeps its own data in. Run from a checkout it
// has a name of its own: a checkout can be driven from outside, so it does not share the trusted
// contexts, the approved instruction files or the token of the app that is installed.
app.setName(app.isPackaged ? 'Mate' : 'Mate Dev')

/** The context each window has open, by the id of its page. A window knows nothing of another's. */
const contexts = new Map<number, string>()

// An app that was installed carries the helper in its resources. In a checkout it is where
// `pnpm build:assist` puts it. MATE_ASSIST names another one.
const assistHelper =
  process.env.MATE_ASSIST ?? (app.isPackaged ? path.join(process.resourcesPath, 'mate-assist') : path.join(__dirname, '../../assist/mate-assist'))

// An app that was installed is not driven from outside. The port the end-to-end test asks for is for a checkout.
if (app.isPackaged) app.commandLine.removeSwitch('remote-debugging-port')

/** The files the reader chose in the file dialog, by a number the window is given in place of the path. */
const chosen = new Map<string, string>()

/** A folder named on the command line is the context the first window opens: `mate <folder>`. */
function contextFromArgv(): string | undefined {
  // Before the folder come the program and, when it is not packaged, the app it runs.
  const named = process.argv.slice(app.isPackaged ? 1 : 2).find((each) => !each.startsWith('-') && existsSync(each) && statSync(each).isDirectory())
  return named && path.resolve(named)
}

/** A new window starts in the context of the window it was opened from, with no project open. */
function createWindow(from?: BrowserWindow | null, open?: string): void {
  // A window again while the app waited for an agent to finish: the reader is back, and can be asked.
  if (finishing) {
    finishing = false
    attend(true)
  }
  const beside = from?.getPosition()
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 560,
    // Not on top of the window it came from, or it looks as if nothing opened.
    ...(beside ? { x: beside[0] + 28, y: beside[1] + 28 } : {}),
    title: 'Mate',
    // On the Mac the window buttons sit in the rail's top bar. styles.css leaves room for them.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    // The page colour from styles.css, so the window does not flash white before it loads.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1f1e1b' : '#fbfaf7',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  // The window is one page and stays that page. A file dropped on it is taken as a source, and must
  // never be opened in its place. Nothing in it opens another window either.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault()
  })

  const id = window.webContents.id
  const inherited = open ?? (from ? contexts.get(from.webContents.id) : undefined)
  if (inherited) contexts.set(id, inherited)
  if (open) void refreshIndex(open).catch(() => {})
  window.on('closed', () => contexts.delete(id))

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

/** Show a session's progress in every window that has its context open, and in no other. */
function tell(contextDir: string, session: Session): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (contexts.get(window.webContents.id) === contextDir) window.webContents.send('session:update', session)
  }
}

/** Tell every window of a context something on a channel of its own. */
function toContext(contextDir: string, channel: string, value: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (contexts.get(window.webContents.id) === contextDir) window.webContents.send(channel, value)
  }
}

/** The text twins being made, by context. One run at a time for a context. */
const reading = new Map<string, Promise<void>>()
/** The vectors for search by meaning being made, by context. One run at a time for a context. */
const minding = new Map<string, Promise<void>>()

/**
 * Give the passages of a context their vectors, in the background, after its twins: only where
 * Ollama with the model is on this computer. Its windows hear how many files are left.
 */
function learnMeaning(contextDir: string): void {
  if (minding.has(contextDir)) return
  const say = (left: number) => toContext(contextDir, 'context:minding', left)
  const run = (async () => {
    if (await meaningMissing()) return
    await refreshMeaning(contextDir, await refreshIndex(contextDir), ollamaEmbed, say)
  })()
    .catch(() => {})
    .finally(() => {
      minding.delete(contextDir)
      say(0)
    })
  minding.set(contextDir, run)
}

/**
 * Bring the text twins of a context up to date, in the background: nothing waits for it. Its
 * windows hear how many files are left to read, and the index takes in what was read.
 */
function readTwins(contextDir: string): void {
  if (reading.has(contextDir)) return
  const say = (left: number) => toContext(contextDir, 'context:reading', left)
  const run = refreshTwins(contextDir, assistHelper, say)
    .then((changed) => (changed > 0 ? refreshIndex(contextDir).then(() => undefined) : undefined))
    .catch(() => {})
    .finally(() => {
      reading.delete(contextDir)
      say(0)
      // What was read is given its meaning next.
      learnMeaning(contextDir)
    })
  reading.set(contextDir, run)
}

/**
 * The door for an agent the reader runs themselves. It is opened the first time the reader asks
 * for it, not before, and it leads to the one session the reader last opened for such an agent.
 */
let door: Promise<{ port: number }> | null = null
let bound: Binding | null = null

function doorToken(): string {
  const file = path.join(app.getPath('userData'), 'mcp-token')
  // Kept from one run to the next, so the reader sets their agent up once.
  if (!existsSync(file)) writeFileSync(file, randomBytes(24).toString('hex'), { mode: 0o600 })
  return readFileSync(file, 'utf8').trim()
}

/**
 * Tokens of the doors that only read, each for the session of an agent Mate started. They last as
 * long as the app: a token reads only a context that whoever runs as the reader can read anyway.
 */
const guests = new Map<string, Binding>()

/** The door, started the first time something needs it. */
function startDoor(): Promise<{ port: number }> {
  door ??= startMcp({
    port: Number(process.env.MATE_MCP_PORT) || 41757,
    token: doorToken(),
    binding: () => bound,
    changed: (at, session) => tell(at.contextDir, session),
    guest: (token) => guests.get(token) ?? null
  })
  return door
}

async function openDoor(binding: Binding): Promise<{ url: string; token: string }> {
  bound = binding
  return { url: `http://127.0.0.1:${(await startDoor()).port}/mcp`, token: doorToken() }
}

// An agent that stays gets a door of its own, for its session, that only reads.
doors.forAgent = async (contextDir, project, id) => {
  const token = randomBytes(24).toString('hex')
  guests.set(token, { contextDir, project, id })
  return { url: `http://127.0.0.1:${(await startDoor()).port}/mcp`, token }
}

function requireContext(event: IpcMainInvokeEvent): string {
  const contextDir = contexts.get(event.sender.id)
  if (!contextDir) throw new Error('Open a context first.')
  return contextDir
}

/** Electron's own menu has no New Window. The rest is the standard set, which the Edit shortcuts need. */
function setMenu(): void {
  const mac = process.platform === 'darwin'
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(mac ? [{ role: 'appMenu' as const }] : []),
      {
        label: 'File',
        submenu: [
          {
            id: 'new-window',
            label: 'New Window',
            accelerator: 'CmdOrCtrl+N',
            click: () => createWindow(BrowserWindow.getFocusedWindow())
          },
          { type: 'separator' },
          { role: mac ? 'close' : 'quit' }
        ]
      },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' }
    ])
  )
}

app.whenReady().then(() => {
  keepTrustIn(path.join(app.getPath('userData'), 'trusted.json'))
  keepPrivacyIn(path.join(app.getPath('userData'), 'private.json'))
  keepOpenedIn(path.join(app.getPath('userData'), 'opened.json'))
  keepEndpointIn(path.join(app.getPath('userData'), 'endpoint.json'), {
    encrypt: (text) => safeStorage.encryptString(text),
    decrypt: (sealed) => safeStorage.decryptString(sealed)
  })
  keepPinsIn(path.join(app.getPath('userData'), 'pins.json'))

  // Before an agent starts: has what the context tells it changed since the reader last saw it?
  // The reader answers in a dialog of the system, which the page cannot press.
  gate.before = async (contextDir) => {
    const now = await instructionFiles(contextDir)
    const changes = unapproved(contextDir, now)
    if (changes.length === 0) return
    const window = BrowserWindow.getAllWindows().find((each) => contexts.get(each.webContents.id) === contextDir)
    const options = {
      type: 'warning' as const,
      buttons: ['Cancel', 'Approve'],
      defaultId: 0,
      cancelId: 0,
      message: 'This context tells the agent what to do',
      detail:
        'An agent reads these files as its instructions. They are new or have changed since you last approved them.\n\n' +
        `${describe(changes)}\n\nApprove them only if you know what they say.`
    }
    const { response } = await (window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options))
    if (response !== 1) throw new Error('The instruction files of this context are not approved. The agent was not started.')
    approve(contextDir, now)
  }

  ipcMain.handle('context:open', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = { properties: ['openDirectory' as const, 'createDirectory' as const] }
    const result = await (window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options))
    if (result.canceled || result.filePaths.length === 0) return null
    const chosen = result.filePaths[0]
    if (!chosen) return null
    contexts.set(event.sender.id, chosen)
    // Built now so that it is there for whatever reads it next. A search brings it up to date again.
    void refreshIndex(chosen).catch(() => {})
    readTwins(chosen)
    return describeContext(chosen)
  })

  // A folder that was opened and is not a context yet is made one when the reader says so. What is in it stays.
  ipcMain.handle('context:shape', async (event) => {
    const contextDir = requireContext(event)
    await shapeContext(contextDir)
    return describeContext(contextDir)
  })

  // A repository where there is none. Git reads nothing of the context for that, so it is done in any context.
  ipcMain.handle('context:track', async (event) => {
    const contextDir = requireContext(event)
    // The guard would take the new files of the repository for the agent's, and put them back.
    if (isBusy(contextDir)) throw new Error('An agent is working in this context. Start the repository when it has finished.')
    if (!inRepository(contextDir)) await startRepository(contextDir, agentEnvironment())
    return describeContext(contextDir)
  })

  // Anything else git does starts what the repository names: its hooks, and what its config says.
  // That is a program from the context, so it is for a context the reader trusts, like a script.
  const mayUseGit = (contextDir: string): void => {
    if (!inRepository(contextDir)) throw new Error('This context is in no git repository.')
    if (!isTrusted(contextDir)) {
      throw new Error('Mate commits only in a context you trust: a repository can name programs that git then starts. Trust this context in the Agent tab, or commit in a terminal.')
    }
  }

  // How much there is to commit. Asked when the reader goes to commit, not kept.
  ipcMain.handle('context:changes', (event) => {
    const contextDir = requireContext(event)
    mayUseGit(contextDir)
    return uncommitted(contextDir, agentEnvironment())
  })

  ipcMain.handle('context:commit', (event, message: string) => {
    const contextDir = requireContext(event)
    mayUseGit(contextDir)
    // What an agent is in the middle of is not what the reader means to keep.
    if (isBusy(contextDir)) throw new Error('An agent is working in this context. Commit when it has finished.')
    return commitContext(contextDir, String(message), agentEnvironment())
  })

  // A context that is not there yet. The reader names it and says where in a dialog of the system:
  // the window never names a folder for main to make.
  ipcMain.handle('context:create', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = { title: 'New context', buttonLabel: 'Create', nameFieldLabel: 'Name:', properties: ['createDirectory' as const] }
    const result = await (window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options))
    if (result.canceled || !result.filePath) return null
    await createContext(result.filePath)
    contexts.set(event.sender.id, result.filePath)
    readTwins(result.filePath)
    return describeContext(result.filePath)
  })

  // What a window has open when it starts: the context it inherited, or nothing.
  ipcMain.handle('context:current', async (event) => {
    const dir = contexts.get(event.sender.id)
    if (dir) readTwins(dir)
    return dir ? describeContext(dir) : null
  })

  // The search is made with what is read so far. A file read since is found by the next one.
  ipcMain.handle('context:search', async (event, query: string) => {
    const contextDir = requireContext(event)
    readTwins(contextDir)
    return searchIndex(await refreshIndex(contextDir), query)
  })

  // The passages closest in meaning to the question, from what has its vectors so far.
  // The host of the reader's endpoint, when it may judge passages of this context: not in a private one that
  // is not opened to it. Null otherwise.
  ipcMain.handle('endpoint:judges', (event) => {
    const endpoint = endpointView()
    return endpoint && privacyAllows(requireContext(event), 'private', null) ? new URL(endpoint.url).host : null
  })

  // The reader's endpoint picks, of the thirty passages closest in meaning, those that answer the question,
  // under the bar too. Mate sends them itself, when the reader presses the button; no agent is involved.
  // `leave` is the passage that was asked about, for Near it: the judge must not see it, or it picks it first.
  ipcMain.handle('context:judge', async (event, question: string, leave?: { path: string; start: number; end: number }) => {
    const contextDir = requireContext(event)
    if (!privacyAllows(contextDir, 'private', null)) throw new Error(privacyRefusal(contextDir))
    const missing = await meaningMissing()
    if (missing) throw new Error(missing)
    const outside = (hit: Hit) =>
      !leave || hit.path !== String(leave.path) || hit.start === null || hit.start >= Number(leave.end) || hit.start + hit.length <= Number(leave.start)
    const candidates = (await searchMeaning(contextDir, await refreshIndex(contextDir), String(question), ollamaEmbed, 32, 0))
      .filter((hit) => hit.kind !== 'pane' && outside(hit))
      .slice(0, 30)
    const order = await judgeOnEndpoint(String(question), candidates.map((hit) => ({ title: hit.title, text: hit.passage ?? '' })))
    return { asked: candidates.length, hits: order.map((at) => candidates[at]) }
  })

  // The rail shows a few passages. A question on the page asks for more: up to 30.
  ipcMain.handle('context:meaning', async (event, query: string, limit?: number) => {
    const contextDir = requireContext(event)
    const missing = await meaningMissing()
    if (missing) return { missing, hits: [] }
    const many = Math.min(Math.max(Math.floor(Number(limit)) || 8, 1), 30)
    return { missing: null, hits: await searchMeaning(contextDir, await refreshIndex(contextDir), String(query), ollamaEmbed, many) }
  })

  ipcMain.handle('file:read', (event, relative: string) => readContextFile(requireContext(event), relative))

  // A file Mate cannot draw is shown where it lies, for the reader to open with what they have.
  // It is shown, never opened: opening a file from a context could run it.
  ipcMain.handle('file:reveal', async (event, relative: string) => shell.showItemInFolder(await placeOnDisk(requireContext(event), relative)))

  ipcMain.handle('project:open', (event, project: string, file?: string) =>
    readProject(requireContext(event), project, file)
  )

  ipcMain.handle('project:create', async (event, name: string) => {
    const contextDir = requireContext(event)
    const made = await createProject(contextDir, String(name))
    return { made, context: await describeContext(contextDir) }
  })

  // A folder is renamed only while nothing works in it: an agent, or Mate reading its files.
  const still = (contextDir: string): void => {
    if (isBusy(contextDir)) throw new Error('An agent is working in this context. Rename it when the agent has finished.')
    if (reading.has(contextDir) || minding.has(contextDir)) {
      throw new Error('Mate is still reading the files of this context. Rename it when the rail no longer says so.')
    }
  }

  // A folder the reader has, often a repository, is brought in as a project. It is moved, as it is,
  // after the reader has chosen it and said yes in dialogs of the system.
  ipcMain.handle('project:import', async (event) => {
    const contextDir = requireContext(event)
    still(contextDir)
    const window = BrowserWindow.fromWebContents(event.sender)
    const pick = { title: 'Bring in a project', buttonLabel: 'Bring In', properties: ['openDirectory' as const] }
    const picked = await (window ? dialog.showOpenDialog(window, pick) : dialog.showOpenDialog(pick))
    const from = picked.filePaths[0]
    if (picked.canceled || !from) return null
    const name = path.basename(from)
    const ask = {
      type: 'question' as const,
      message: `Move “${name}” into ${path.basename(contextDir)}?`,
      detail:
        `It is moved, not copied, to projects/${name}/ in this context, and is no longer at ${from}. ` +
        'Nothing in it is changed: its files stay where they are in it, and a git repository keeps its history and its remote. ' +
        'Its markdown files are its drafts.',
      buttons: ['Move It In', 'Cancel'],
      defaultId: 0,
      cancelId: 1
    }
    const { response } = await (window ? dialog.showMessageBox(window, ask) : dialog.showMessageBox(ask))
    if (response !== 0) return null
    const made = await importProject(contextDir, from)
    readTwins(contextDir)
    return { made, context: await describeContext(contextDir) }
  })

  ipcMain.handle('context:rename', async (event, name: string) => {
    const contextDir = requireContext(event)
    still(contextDir)
    const was = realpathSync(contextDir)
    await closeAgentsIn(contextDir)
    const moved = await renameContext(contextDir, String(name))
    if (moved === contextDir) return describeContext(contextDir)
    // Trust, privacy and the approved instruction files were given to this folder. They follow it to its new name.
    moveTrust(was, moved)
    movePrivacy(was, moved)
    moveOpened(was, moved)
    movePins(was, moved)
    forgetMeaning(contextDir)
    for (const [id, dir] of contexts) if (dir === contextDir) contexts.set(id, moved)
    if (bound?.contextDir === contextDir) bound = { ...bound, contextDir: moved }
    const opened = await describeContext(moved)
    // Another window on the same context follows it too.
    toContext(moved, 'context:moved', opened)
    readTwins(moved)
    return opened
  })

  ipcMain.handle('project:rename', async (event, from: string, name: string) => {
    const contextDir = requireContext(event)
    still(contextDir)
    await closeAgentsIn(contextDir)
    const made = await renameProject(contextDir, String(from), String(name))
    await moveSessions(contextDir, String(from), made)
    await moveMeaning(contextDir, `projects/${from}/`, `projects/${made}/`)
    if (bound?.contextDir === contextDir && bound.project === from) bound = { ...bound, project: made }
    return { made, context: await describeContext(contextDir) }
  })

  ipcMain.handle(
    'comment:add',
    (
      event,
      project: string,
      file: string,
      anchor: string,
      text: string,
      author: string,
      from?: number,
      suggestion?: string
    ) => addComment(requireContext(event), project, file, anchor, text, author, from, suggestion)
  )

  ipcMain.handle('comment:reply', (event, project: string, file: string, id: string, text: string, author: string) =>
    editDraft(requireContext(event), project, file, (markdown) => addReply(markdown, id, text, author))
  )

  // The reader types in the open draft, or starts a new one. No agent can reach these two.
  ipcMain.handle('draft:write', (event, project: string, file: string, base: string, text: string) =>
    writeDraft(requireContext(event), project, file, String(base), String(text))
  )
  ipcMain.handle('draft:create', (event, project: string, name: string) => createDraft(requireContext(event), project, String(name)))

  ipcMain.handle('shelf:list', (event) => listShelf(requireContext(event)))
  ipcMain.handle('context:files', (event) => listContextFiles(requireContext(event)))

  // A shelf document is taken down into a project as a copy to work on. The shelf keeps its own.
  ipcMain.handle('shelf:take', (event, project: string, relative: string) => takeDown(requireContext(event), project, String(relative)))

  // A source comes in from outside the context. The reader picks it in the dialog of the system, and
  // the window is given a number for it, not the right to name any path it likes.
  // `near` is where the dialog opens: a file that was dropped on the window is shown there, to be chosen.
  ipcMain.handle('source:pick', async (event, near?: string) => {
    requireContext(event)
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = {
      properties: ['openFile' as const, 'openDirectory' as const, 'multiSelections' as const],
      ...(typeof near === 'string' && path.isAbsolute(near) ? { defaultPath: near } : {})
    }
    const result = await (window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options))
    return result.canceled
      ? []
      : result.filePaths.map((each) => {
          const id = randomBytes(8).toString('hex')
          chosen.set(id, each)
          const folder = statSync(each).isDirectory()
          return { id, name: path.basename(each), where: each, markdown: !folder && each.toLowerCase().endsWith('.md'), folder }
        })
  })

  // Only where the file lies is written down, so a path from a file dropped on the window is taken too.
  ipcMain.handle('source:note', (event, project: string, source: string) =>
    noteSource(requireContext(event), project, chosen.get(String(source)) ?? String(source))
  )

  // The document itself is copied in, so only a file the reader chose in the dialog is.
  ipcMain.handle('source:pull', (event, project: string, id: string) => {
    const source = chosen.get(String(id))
    if (!source) throw new Error('Choose the file with Add a source first.')
    return copySource(requireContext(event), project, source)
  })

  // A folder is copied in whole, so only one the reader chose in the dialog is. While an agent works,
  // its files would be taken for the agent's.
  ipcMain.handle('source:copy', async (event, project: string, id: string) => {
    const contextDir = requireContext(event)
    const source = chosen.get(String(id))
    if (!source) throw new Error('Choose the folder with Add a source first.')
    if (isBusy(contextDir)) throw new Error('An agent is working in this context. Copy the folder in when it has finished.')
    const copied = await copyFolder(contextDir, project, source)
    readTwins(contextDir)
    return copied
  })

  // A document in a dropbox is pulled into the project's drafts. It leaves the dropbox.
  ipcMain.handle('dropbox:pull', (event, project: string, relative: string) => pullIn(requireContext(event), project, String(relative)))

  // Publishing is the reader's act, and no agent's. The shelf is what every project reads as true, so the
  // reader says yes in a dialog of the system, which the page cannot press. It names what is replaced.
  ipcMain.handle('draft:publish', async (event, project: string, file: string, name: string) => {
    const contextDir = requireContext(event)
    const open = (await readProject(contextDir, project, file)).comments.filter((each) => !each.resolved).length
    const target = shelfPath(String(name))
    const replaces = (await listShelf(contextDir)).includes(target.slice('shelf/'.length))
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = {
      type: 'question' as const,
      buttons: ['Cancel', 'Publish'],
      defaultId: 0,
      cancelId: 0,
      message: `Publish ${file} to the shelf?`,
      detail:
        `projects/${project}/draft/${file}\nbecomes\n${target}\n\n` +
        (replaces
          ? 'It takes the place of the document that is there. That one is kept as history, and is no longer current.'
          : 'It is a new document on the shelf.') +
        (open > 0 ? `\n\n${open === 1 ? 'One comment on the draft is' : `${open} comments on the draft are`} still open. Comments are not published.` : '') +
        '\n\nEvery project of this context reads the shelf as what is true now.'
    }
    const { response } = await (window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options))
    return response === 1 ? publish(contextDir, project, file, String(name)) : null
  })

  // The reader ticks a task in a pane. One character of the pane's file changes, and no other file can.
  ipcMain.handle('pane:tick', (event, project: string, name: string, base: string, at: number, draft?: string) =>
    tickPane(requireContext(event), project, String(name), String(base), Number(at), draft)
  )

  // The other handler that changes the prose. It runs when the reader presses Apply, never otherwise.
  ipcMain.handle('comment:apply', (event, project: string, file: string, id: string) =>
    editDraft(requireContext(event), project, file, (markdown) => applySuggestion(markdown, id))
  )

  ipcMain.handle('comment:anchor', (event, project: string, file: string, id: string, anchor: string, from?: number) =>
    editDraft(requireContext(event), project, file, (markdown) => anchorComment(markdown, id, anchor, from))
  )

  ipcMain.handle('agents:list', () => [...listAgents(), { kind: 'mcp', label: 'Your own agent', found: true, host: null }])

  ipcMain.handle('mcp:bind', (event, project: string, id: string) => {
    const contextDir = requireContext(event)
    if (isPrivate(contextDir)) throw new Error(PRIVATE)
    return openDoor({ contextDir, project, id })
  })

  ipcMain.handle('session:list', (event, project: string) => listSessions(requireContext(event), project))

  ipcMain.handle('session:start', (event, project: string, agent: Invited, host?: string) =>
    startSession(requireContext(event), project, agent, host ?? null)
  )

  // An approval is a message like any other. The answer arrives as 'session:update' events.
  ipcMain.handle('session:send', async (event, project: string, id: string, text: string, approve: boolean, wait?: boolean) => {
    const contextDir = requireContext(event)
    const turn = await sendMessage(contextDir, project, id, text, approve, (session) => tell(contextDir, session), wait === true)
    // Said from a pane or from a file's card, not from the conversation: the conversation shows it at once all the same.
    tell(contextDir, turn.started)
    return turn.started
  })

  ipcMain.handle('session:stop', (_event, id: string) => stopTurn(id))

  // The reader's yes or no to what an agent asked before it goes on. Yes is for that one thing, once.
  ipcMain.handle('session:answer', (_event, id: string, ask: string, allow: boolean) => answerAsk(String(id), String(ask), allow === true))

  // The reader opened the choice of model. Hermes is asked what it offers, once for each run of the app.
  ipcMain.handle('session:models', (event) => (requireContext(event), listModels()))

  ipcMain.handle('session:tune', async (event, project: string, id: string, model: unknown, effort: unknown) => {
    const contextDir = requireContext(event)
    const session = await tuneSession(contextDir, project, id, typeof model === 'string' ? model : null, typeof effort === 'string' ? effort : null)
    tell(contextDir, session)
    return session
  })

  ipcMain.handle('session:revert', (event, project: string, id: string, index: number) =>
    revertChange(requireContext(event), project, id, index)
  )

  ipcMain.handle('session:settle', (event, project: string, id: string, index: number, approve: boolean) =>
    settleHeld(requireContext(event), project, id, index, approve)
  )

  ipcMain.handle('trust:get', (event) => isTrusted(requireContext(event)))

  // Trust is given in a dialog of the system, which the page cannot press. Taking it away asks nothing.
  ipcMain.handle('trust:set', async (event, yes: boolean) => {
    const contextDir = requireContext(event)
    if (yes === true) {
      const window = BrowserWindow.fromWebContents(event.sender)
      const options = {
        type: 'warning' as const,
        buttons: ['Cancel', 'Trust This Context'],
        defaultId: 0,
        cancelId: 0,
        message: 'Trust this context?',
        detail:
          `${contextDir}\n\n` +
          'Hermes will run here as it does in your own terminal. It can run commands, use your connections, ' +
          'and change files outside this folder. Mate does not see what it does outside this folder.\n\n' +
          'Trust only a folder whose files you know.'
      }
      const { response } = await (window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options))
      if (response !== 1) return false
    }
    setTrusted(contextDir, yes === true)
    return isTrusted(contextDir)
  })

  ipcMain.handle('privacy:get', (event) => isPrivate(requireContext(event)))

  // Keeping a context private asks nothing: it only takes away. The agents left idle in it are stopped. Letting
  // agents in again is asked in a dialog of the system, which the page cannot press, since its text may then leave.
  ipcMain.handle('privacy:set', async (event, yes: boolean) => {
    const contextDir = requireContext(event)
    if (yes === true) {
      if (isBusy(contextDir)) throw new Error('An agent is working in this context. Keep it private when the agent has finished.')
      await closeAgentsIn(contextDir)
    } else {
      const window = BrowserWindow.fromWebContents(event.sender)
      const options = {
        type: 'warning' as const,
        buttons: ['Cancel', 'Let Agents In'],
        defaultId: 0,
        cancelId: 0,
        message: 'Let agents work in this context again?',
        detail:
          `${contextDir}\n\n` +
          'An agent you invite sends what it reads here off this computer: to where its model runs, such as Anthropic, ' +
          'OpenAI or OpenRouter, or to another machine over SSH. ' +
          'Your own agent can come in through the door again.'
      }
      const { response } = await (window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options))
      if (response !== 1) return true
    }
    setPrivate(contextDir, yes === true)
    // Made private again later, it starts closed to the endpoint too: the reader opens it again, by name.
    if (yes !== true) setOpenedToEndpoint(contextDir, false)
    return isPrivate(contextDir)
  })

  // The reader's endpoint: what the window may know of it, never the key.
  ipcMain.handle('endpoint:get', () => endpointView())

  // A new host is not trusted with the contexts that were opened to the old one: each is opened again, by name.
  ipcMain.handle('endpoint:set', (_event, url: string, model: string, key?: string) => {
    if (setEndpoint(String(url), String(model), typeof key === 'string' && key ? key : undefined)) closeAllToEndpoint()
    return endpointView()
  })

  ipcMain.handle('privacy:opened', (event) => isOpenedToEndpoint(requireContext(event)))

  // The text of a private context may go to the reader's endpoint only after they say so in a dialog of
  // the system, which names the host. Closing it again asks nothing.
  ipcMain.handle('privacy:open', async (event, yes: boolean) => {
    const contextDir = requireContext(event)
    if (!isPrivate(contextDir)) throw new Error('Keep this context private first.')
    if (yes === true) {
      const endpoint = endpointView()
      if (!endpoint) throw new Error('Set your endpoint first.')
      const host = new URL(endpoint.url).host
      const window = BrowserWindow.fromWebContents(event.sender)
      const options = {
        type: 'warning' as const,
        buttons: ['Cancel', `Allow ${host}`],
        defaultId: 0,
        cancelId: 0,
        message: `Let Hermes send this private context to ${host}?`,
        detail:
          `${contextDir}\n\n` +
          `What Hermes reads here goes to ${endpoint.url}, to the model ${endpoint.model}, and to nowhere else: ` +
          'Hermes runs in the sandbox of macOS and reaches only Mate, which passes its requests to that address. ' +
          'Allow it only if you control that server, or trust who does.'
      }
      const { response } = await (window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options))
      if (response !== 1) return false
    } else if (isBusy(contextDir)) {
      throw new Error('An agent is working in this context. Close it to the endpoint when the agent has finished.')
    }
    setOpenedToEndpoint(contextDir, yes === true)
    if (yes !== true) await closeAgentsIn(contextDir)
    return isOpenedToEndpoint(contextDir)
  })

  // What a kept or a held change is, as lines. It reads and writes nothing else.
  ipcMain.handle('session:compare', (event, project: string, id: string, which: string, index: number) =>
    compare(requireContext(event), project, id, which === 'held' ? 'held' : 'kept', Number(index))
  )

  // The reader presses a button, and a script of the project runs: no agent, and nothing off this computer.
  // scripts.ts checks that the reader trusts the context, and that the file is one of the project's scripts.
  ipcMain.handle('script:run', (event, project: string, line: string) => runScript(requireContext(event), project, String(line)))
  ipcMain.handle('script:stop', (event) => stopScript(requireContext(event)))

  ipcMain.handle('assist:check', () => checkAssist(assistHelper))

  // The text goes back to the window for the reader to accept. This handler writes nothing.
  ipcMain.handle('assist:run', (_event, task: AssistTask, passage: string, note: string) =>
    runAssist(assistHelper, task, passage, note)
  )

  setMenu()
  createWindow(null, contextFromArgv())
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quitting while an agent works is the reader's call: let it finish, or stop it.
// `leaving`: it is decided, and the app goes. `finishing`: the windows are closed, and the app
// waits for the agents. The app stays, since what an agent changes is checked from here.
let leaving = false
let finishing = false

app.on('before-quit', (event) => {
  if (!leaving && working() > 0) {
    event.preventDefault()
    void askAboutAgents()
    return
  }
  stopAllScripts()
  stopRelay()
  stopAllTurns()
})

async function askAboutAgents(): Promise<void> {
  const window = BrowserWindow.getFocusedWindow()
  const options = {
    type: 'question' as const,
    message: working() === 1 ? 'An agent is still working.' : 'Agents are still working.',
    detail:
      'Let it finish: Mate closes its windows and quits by itself when the work is done. What the agent changes is checked as always. If it asks before it does something, the answer is no.\n\n' +
      'Stop it: the turn is cut off, and the session says so when you open it again.',
    buttons: ['Let It Finish, Then Quit', 'Stop It and Quit', 'Cancel'],
    defaultId: 0,
    cancelId: 2
  }
  const { response } = await (window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options))
  if (response === 2) return
  if (response === 0) {
    finishing = true
    attend(false)
    for (const each of BrowserWindow.getAllWindows()) each.close()
    await whenIdle()
    // The reader opened a window again meanwhile: they are back, and nothing quits.
    if (!finishing) return
  }
  leaving = true
  app.quit()
}

app.on('window-all-closed', () => {
  // With its windows closed to let an agent finish, the app is not done yet.
  if (process.platform !== 'darwin' && !finishing) app.quit()
})
