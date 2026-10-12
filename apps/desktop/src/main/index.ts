import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron'
import path from 'node:path'
import { addReply, anchorComment, applySuggestion } from '../shared/comments'
import { addComment, editDraft, listProjects, readProject } from './context'

let contextDir: string | null = null

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 560,
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
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function requireContext(): string {
  if (!contextDir) throw new Error('Open a context first.')
  return contextDir
}

app.whenReady().then(() => {
  ipcMain.handle('context:open', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    const chosen = result.filePaths[0]
    if (!chosen) return null
    contextDir = chosen
    return { dir: chosen, projects: await listProjects(chosen) }
  })

  ipcMain.handle('project:open', (_event, project: string, file?: string) =>
    readProject(requireContext(), project, file)
  )

  ipcMain.handle(
    'comment:add',
    (
      _event,
      project: string,
      file: string,
      anchor: string,
      text: string,
      author: string,
      from?: number,
      suggestion?: string
    ) => addComment(requireContext(), project, file, anchor, text, author, from, suggestion)
  )

  ipcMain.handle('comment:reply', (_event, project: string, file: string, id: string, text: string, author: string) =>
    editDraft(requireContext(), project, file, (markdown) => addReply(markdown, id, text, author))
  )

  // The only handler that changes the prose. It runs when the reader presses Apply, never otherwise.
  ipcMain.handle('comment:apply', (_event, project: string, file: string, id: string) =>
    editDraft(requireContext(), project, file, (markdown) => applySuggestion(markdown, id))
  )

  ipcMain.handle('comment:anchor', (_event, project: string, file: string, id: string, anchor: string, from?: number) =>
    editDraft(requireContext(), project, file, (markdown) => anchorComment(markdown, id, anchor, from))
  )

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
