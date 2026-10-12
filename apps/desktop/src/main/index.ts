import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import { addReply, anchorComment, applySuggestion } from '../shared/comments'
import { checkAssist, runAssist, type AssistTask } from './assist'
import { addComment, editDraft, listProjects, readProject } from './context'

// The name in the menu bar. Without this it is the package name.
app.setName('Mate')

/** The context each window has open, by the id of its page. A window knows nothing of another's. */
const contexts = new Map<number, string>()

// ponytail: the helper is looked for beside the app in this checkout, where `pnpm build:assist` puts it.
// A packaged app will carry it in its resources. MATE_ASSIST names another one.
const assistHelper = process.env.MATE_ASSIST ?? path.join(__dirname, '../../assist/mate-assist')

/** A new window starts in the context of the window it was opened from, with no project open. */
function createWindow(from?: BrowserWindow | null): void {
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
  const id = window.webContents.id
  const inherited = from ? contexts.get(from.webContents.id) : undefined
  if (inherited) contexts.set(id, inherited)
  window.on('closed', () => contexts.delete(id))

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
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
  ipcMain.handle('context:open', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = { properties: ['openDirectory' as const] }
    const result = await (window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options))
    if (result.canceled || result.filePaths.length === 0) return null
    const chosen = result.filePaths[0]
    if (!chosen) return null
    contexts.set(event.sender.id, chosen)
    return { dir: chosen, projects: await listProjects(chosen) }
  })

  // What a window has open when it starts: the context it inherited, or nothing.
  ipcMain.handle('context:current', async (event) => {
    const dir = contexts.get(event.sender.id)
    return dir ? { dir, projects: await listProjects(dir) } : null
  })

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

  // The only handler that changes the prose. It runs when the reader presses Apply, never otherwise.
  ipcMain.handle('comment:apply', (event, project: string, file: string, id: string) =>
    editDraft(requireContext(event), project, file, (markdown) => applySuggestion(markdown, id))
  )

  ipcMain.handle('comment:anchor', (event, project: string, file: string, id: string, anchor: string, from?: number) =>
    editDraft(requireContext(event), project, file, (markdown) => anchorComment(markdown, id, anchor, from))
  )

  ipcMain.handle('assist:check', () => checkAssist(assistHelper))

  // The text goes back to the window for the reader to accept. This handler writes nothing.
  ipcMain.handle('assist:run', (_event, task: AssistTask, passage: string, note: string) =>
    runAssist(assistHelper, task, passage, note)
  )

  setMenu()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
