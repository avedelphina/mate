import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('mate', {
  openContext: (): Promise<{ dir: string; projects: string[] } | null> => ipcRenderer.invoke('context:open'),
  openProject: (project: string, file?: string) => ipcRenderer.invoke('project:open', project, file),
  addComment: (
    project: string,
    file: string,
    anchor: string,
    text: string,
    author: string,
    from?: number,
    suggestion?: string
  ) => ipcRenderer.invoke('comment:add', project, file, anchor, text, author, from, suggestion),
  addReply: (project: string, file: string, id: string, text: string, author: string) =>
    ipcRenderer.invoke('comment:reply', project, file, id, text, author),
  applySuggestion: (project: string, file: string, id: string) =>
    ipcRenderer.invoke('comment:apply', project, file, id),
  anchorComment: (project: string, file: string, id: string, anchor: string, from?: number) =>
    ipcRenderer.invoke('comment:anchor', project, file, id, anchor, from),
  checkAssist: () => ipcRenderer.invoke('assist:check'),
  runAssist: (task: 'rewrite' | 'note', passage: string, note: string) =>
    ipcRenderer.invoke('assist:run', task, passage, note)
})
