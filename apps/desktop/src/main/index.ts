import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'node:path'
import { addComment, listProjects, readProject } from './context'

let contextDir: string | null = null

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1100,
    height: 800,
    title: 'Mate',
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
    (_event, project: string, file: string, anchor: string, text: string, author: string, from?: number) =>
      addComment(requireContext(), project, file, anchor, text, author, from)
  )

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
