import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('mate', {
  openContext: (): Promise<{ dir: string; projects: string[] } | null> => ipcRenderer.invoke('context:open'),
  currentContext: (): Promise<{ dir: string; projects: string[] } | null> => ipcRenderer.invoke('context:current'),
  searchContext: (query: string) => ipcRenderer.invoke('context:search', query),
  readFile: (path: string) => ipcRenderer.invoke('file:read', path),
  revealFile: (path: string) => ipcRenderer.invoke('file:reveal', path),
  openProject: (project: string, file?: string) => ipcRenderer.invoke('project:open', project, file),
  writeDraft: (project: string, file: string, base: string, text: string) => ipcRenderer.invoke('draft:write', project, file, base, text),
  createDraft: (project: string, name: string) => ipcRenderer.invoke('draft:create', project, name),
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
  listAgents: () => ipcRenderer.invoke('agents:list'),
  bindMcp: (project: string, id: string) => ipcRenderer.invoke('mcp:bind', project, id),
  listSessions: (project: string) => ipcRenderer.invoke('session:list', project),
  startSession: (project: string, agent: string, host?: string) =>
    ipcRenderer.invoke('session:start', project, agent, host),
  sendMessage: (project: string, id: string, text: string, approve: boolean) =>
    ipcRenderer.invoke('session:send', project, id, text, approve),
  stopTurn: (id: string) => ipcRenderer.invoke('session:stop', id),
  answerAsk: (id: string, ask: string, allow: boolean) => ipcRenderer.invoke('session:answer', id, ask, allow),
  revertChange: (project: string, id: string, index: number) => ipcRenderer.invoke('session:revert', project, id, index),
  compare: (project: string, id: string, which: 'kept' | 'held', index: number) =>
    ipcRenderer.invoke('session:compare', project, id, which, index),
  settleHeld: (project: string, id: string, index: number, approve: boolean) =>
    ipcRenderer.invoke('session:settle', project, id, index, approve),
  /** Returns the function that stops listening. */
  onSession: (listener: (session: unknown) => void) => {
    const heard = (_event: unknown, session: unknown) => listener(session)
    ipcRenderer.on('session:update', heard)
    return () => ipcRenderer.removeListener('session:update', heard)
  },
  isTrusted: (): Promise<boolean> => ipcRenderer.invoke('trust:get'),
  setTrusted: (yes: boolean): Promise<boolean> => ipcRenderer.invoke('trust:set', yes),
  checkAssist: () => ipcRenderer.invoke('assist:check'),
  runAssist: (task: 'rewrite' | 'note', passage: string, note: string) =>
    ipcRenderer.invoke('assist:run', task, passage, note)
})
