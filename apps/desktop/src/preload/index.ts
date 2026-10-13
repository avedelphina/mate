import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('mate', {
  openContext: () => ipcRenderer.invoke('context:open'),
  shapeContext: () => ipcRenderer.invoke('context:shape'),
  trackContext: () => ipcRenderer.invoke('context:track'),
  countChanges: (): Promise<number> => ipcRenderer.invoke('context:changes'),
  commit: (message: string): Promise<number> => ipcRenderer.invoke('context:commit', message),
  newContext: () => ipcRenderer.invoke('context:create'),
  currentContext: () => ipcRenderer.invoke('context:current'),
  searchContext: (query: string) => ipcRenderer.invoke('context:search', query),
  readFile: (path: string) => ipcRenderer.invoke('file:read', path),
  revealFile: (path: string) => ipcRenderer.invoke('file:reveal', path),
  openProject: (project: string, file?: string) => ipcRenderer.invoke('project:open', project, file),
  createProject: (name: string) => ipcRenderer.invoke('project:create', name),
  tickPane: (project: string, name: string, base: string, at: number, draft?: string) =>
    ipcRenderer.invoke('pane:tick', project, name, base, at, draft),
  listShelf: () => ipcRenderer.invoke('shelf:list'),
  takeDown: (project: string, path: string) => ipcRenderer.invoke('shelf:take', project, path),
  pickSources: (near?: string) => ipcRenderer.invoke('source:pick', near),
  noteSource: (project: string, source: string) => ipcRenderer.invoke('source:note', project, source),
  pullSource: (project: string, id: string) => ipcRenderer.invoke('source:pull', project, id),
  /** Where a file dropped on the window lies. The window cannot read it: it can only have it noted. */
  pathOf: (file: File) => webUtils.getPathForFile(file),
  pullIn: (project: string, path: string) => ipcRenderer.invoke('dropbox:pull', project, path),
  publishDraft: (project: string, file: string, name: string) => ipcRenderer.invoke('draft:publish', project, file, name),
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
  listModels: () => ipcRenderer.invoke('session:models'),
  tuneSession: (project: string, id: string, model: string | null, effort: string | null) =>
    ipcRenderer.invoke('session:tune', project, id, model, effort),
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
  runScript: (project: string, line: string) => ipcRenderer.invoke('script:run', project, line),
  stopScript: () => ipcRenderer.invoke('script:stop'),
  checkAssist: () => ipcRenderer.invoke('assist:check'),
  runAssist: (task: 'rewrite' | 'note', passage: string, note: string) =>
    ipcRenderer.invoke('assist:run', task, passage, note)
})
