import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell, type IpcMainInvokeEvent } from 'electron'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { addReply, anchorComment, applySuggestion } from '../shared/comments'
import { listAgents } from './agents'
import { checkAssist, runAssist, type AssistTask } from './assist'
import {
  addComment,
  copySource,
  createDraft,
  editDraft,
  listProjects,
  listShelf,
  noteSource,
  placeOnDisk,
  publish,
  pullIn,
  readContextFile,
  readProject,
  shelfPath,
  takeDown,
  tickPane,
  writeDraft
} from './context'
import { refreshIndex, searchIndex } from './contextIndex'
import { startMcp, type Binding } from './mcp'
import { runScript, stopAllScripts, stopScript } from './scripts'
import { approve, describe, instructionFiles, keepPinsIn, unapproved } from './pins'
import { isTrusted, keepTrustIn, setTrusted } from './trust'
import {
  answerAsk,
  compare,
  gate,
  listModels,
  listSessions,
  revertChange,
  sendMessage,
  settleHeld,
  startSession,
  stopTurn,
  tuneSession,
  type Invited,
  type Session
} from './sessions'

// The name in the menu bar. Without this it is the package name.
app.setName('Mate')

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

async function openDoor(binding: Binding): Promise<{ url: string; token: string }> {
  bound = binding
  const token = doorToken()
  door ??= startMcp({
    port: Number(process.env.MATE_MCP_PORT) || 41757,
    token,
    binding: () => bound,
    changed: (at, session) => tell(at.contextDir, session)
  })
  return { url: `http://127.0.0.1:${(await door).port}/mcp`, token }
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
    const options = { properties: ['openDirectory' as const] }
    const result = await (window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options))
    if (result.canceled || result.filePaths.length === 0) return null
    const chosen = result.filePaths[0]
    if (!chosen) return null
    contexts.set(event.sender.id, chosen)
    // Built now so that it is there for whatever reads it next. A search brings it up to date again.
    void refreshIndex(chosen).catch(() => {})
    return { dir: chosen, projects: await listProjects(chosen) }
  })

  // What a window has open when it starts: the context it inherited, or nothing.
  ipcMain.handle('context:current', async (event) => {
    const dir = contexts.get(event.sender.id)
    return dir ? { dir, projects: await listProjects(dir) } : null
  })

  ipcMain.handle('context:search', async (event, query: string) =>
    searchIndex(await refreshIndex(requireContext(event)), query)
  )

  ipcMain.handle('file:read', (event, relative: string) => readContextFile(requireContext(event), relative))

  // A file Mate cannot draw is shown where it lies, for the reader to open with what they have.
  // It is shown, never opened: opening a file from a context could run it.
  ipcMain.handle('file:reveal', async (event, relative: string) => shell.showItemInFolder(await placeOnDisk(requireContext(event), relative)))

  ipcMain.handle('project:open', (event, project: string, file?: string) =>
    readProject(requireContext(event), project, file)
  )

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

  // A shelf document is taken down into a project as a copy to work on. The shelf keeps its own.
  ipcMain.handle('shelf:take', (event, project: string, relative: string) => takeDown(requireContext(event), project, String(relative)))

  // A source comes in from outside the context. The reader picks it in the dialog of the system, and
  // the window is given a number for it, not the right to name any path it likes.
  // `near` is where the dialog opens: a file that was dropped on the window is shown there, to be chosen.
  ipcMain.handle('source:pick', async (event, near?: string) => {
    requireContext(event)
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = {
      properties: ['openFile' as const, 'multiSelections' as const],
      ...(typeof near === 'string' && path.isAbsolute(near) ? { defaultPath: near } : {})
    }
    const result = await (window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options))
    return result.canceled
      ? []
      : result.filePaths.map((each) => {
          const id = randomBytes(8).toString('hex')
          chosen.set(id, each)
          return { id, name: path.basename(each), where: each, markdown: each.toLowerCase().endsWith('.md') }
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

  ipcMain.handle('mcp:bind', (event, project: string, id: string) => openDoor({ contextDir: requireContext(event), project, id }))

  ipcMain.handle('session:list', (event, project: string) => listSessions(requireContext(event), project))

  ipcMain.handle('session:start', (event, project: string, agent: Invited, host?: string) =>
    startSession(requireContext(event), project, agent, host ?? null)
  )

  // An approval is a message like any other. The answer arrives as 'session:update' events.
  ipcMain.handle('session:send', async (event, project: string, id: string, text: string, approve: boolean) => {
    const contextDir = requireContext(event)
    const turn = await sendMessage(contextDir, project, id, text, approve, (session) => tell(contextDir, session))
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

app.on('before-quit', stopAllScripts)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
