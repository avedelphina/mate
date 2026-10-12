import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('mate', {
  openContext: (): Promise<{ dir: string; projects: string[] } | null> => ipcRenderer.invoke('context:open'),
  openProject: (project: string, file?: string) => ipcRenderer.invoke('project:open', project, file),
  addComment: (project: string, file: string, anchor: string, text: string, author: string, from?: number) =>
    ipcRenderer.invoke('comment:add', project, file, anchor, text, author, from)
})
