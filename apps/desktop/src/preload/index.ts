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
  contextTags: () => ipcRenderer.invoke('context:tags'),
  searchMeaning: (query: string, limit?: number) => ipcRenderer.invoke('context:meaning', query, limit),
  judgingHost: (): Promise<string | null> => ipcRenderer.invoke('endpoint:judges'),
  judge: (question: string, leave?: { path: string; start: number; end: number }) => ipcRenderer.invoke('context:judge', question, leave),
  readFile: (path: string) => ipcRenderer.invoke('file:read', path),
  revealFile: (path: string) => ipcRenderer.invoke('file:reveal', path),
  openProject: (project: string, file?: string) => ipcRenderer.invoke('project:open', project, file),
  createProject: (name: string) => ipcRenderer.invoke('project:create', name),
  renameContext: (name: string) => ipcRenderer.invoke('context:rename', name),
  importProject: () => ipcRenderer.invoke('project:import'),
  renameProject: (from: string, name: string) => ipcRenderer.invoke('project:rename', from, name),
  /** The open context was renamed, from this window or another. Returns the function that stops listening. */
  onMoved: (listener: (opened: unknown) => void) => {
    const heard = (_event: unknown, opened: unknown) => listener(opened)
    ipcRenderer.on('context:moved', heard)
    return () => ipcRenderer.removeListener('context:moved', heard)
  },
  readNote: (project: string, file: string) => ipcRenderer.invoke('note:read', project, file),
  writeNote: (project: string, file: string, base: string, text: string) => ipcRenderer.invoke('note:write', project, file, base, text),
  makeFolder: (project: string, where: string) => ipcRenderer.invoke('folder:make', project, where),
  tickPane: (project: string, name: string, base: string, at: number, draft?: string) =>
    ipcRenderer.invoke('pane:tick', project, name, base, at, draft),
  writeSteering: (project: string, name: string, base: string, text: string, draft?: string) =>
    ipcRenderer.invoke('steering:write', project, name, base, text, draft),
  listShelf: () => ipcRenderer.invoke('shelf:list'),
  listContextFiles: (): Promise<string[]> => ipcRenderer.invoke('context:files'),
  takeDown: (project: string, path: string) => ipcRenderer.invoke('shelf:take', project, path),
  pickSources: (near?: string) => ipcRenderer.invoke('source:pick', near),
  noteSource: (project: string, source: string) => ipcRenderer.invoke('source:note', project, source),
  pullSource: (project: string, id: string) => ipcRenderer.invoke('source:pull', project, id),
  copyFolder: (project: string, id: string) => ipcRenderer.invoke('source:copy', project, id),
  /** Where a file dropped on the window lies. The window cannot read it: it can only have it noted. */
  pathOf: (file: File) => webUtils.getPathForFile(file),
  pullIn: (project: string, path: string) => ipcRenderer.invoke('dropbox:pull', project, path),
  publishDraft: (project: string, file: string, name: string) => ipcRenderer.invoke('draft:publish', project, file, name),
  writeDraft: (project: string, file: string, base: string, text: string) => ipcRenderer.invoke('draft:write', project, file, base, text),
  createDraft: (project: string, name: string, folder?: string) => ipcRenderer.invoke('draft:create', project, name, folder),
  moveFile: (project: string, from: string, to: string) => ipcRenderer.invoke('file:move', project, from, to),
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
  discoverAgents: () => ipcRenderer.invoke('agents:discover'),
  addAgent: (kind: string, host: string) => ipcRenderer.invoke('agents:add', kind, host),
  removeAgent: (kind: string, host: string) => ipcRenderer.invoke('agents:remove', kind, host),
  bindMcp: (project: string, id: string) => ipcRenderer.invoke('mcp:bind', project, id),
  listSessions: (project: string) => ipcRenderer.invoke('session:list', project),
  startSession: (project: string, agent: string, host?: string) =>
    ipcRenderer.invoke('session:start', project, agent, host),
  sendMessage: (project: string, id: string, text: string, approve: boolean, wait?: boolean) =>
    ipcRenderer.invoke('session:send', project, id, text, approve, wait),
  stopTurn: (id: string) => ipcRenderer.invoke('session:stop', id),
  answerAsk: (id: string, ask: string, allow: boolean, choice?: string, scope?: 'kind' | 'all') => ipcRenderer.invoke('session:answer', id, ask, allow, choice, scope),
  allowNoMore: (project: string, id: string) => ipcRenderer.invoke('session:allow-off', project, id),
  listModels: (agent: 'hermes' | 'kimi') => ipcRenderer.invoke('session:models', agent),
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
  /** How many PDF and Word files of the context are still to be read. Returns the function that stops listening. */
  onReading: (listener: (left: number) => void) => {
    const heard = (_event: unknown, left: number) => listener(left)
    ipcRenderer.on('context:reading', heard)
    return () => ipcRenderer.removeListener('context:reading', heard)
  },
  /** How many files are still to be given their meaning. Returns the function that stops listening. */
  onSettings: (listener: () => void) => {
    const heard = () => listener()
    ipcRenderer.on('settings:open', heard)
    return () => ipcRenderer.removeListener('settings:open', heard)
  },
  settings: () => ipcRenderer.invoke('settings:get'),
  /** Where the update of the installed app is. Returns the function that stops listening. */
  onUpdate: (listener: (update: unknown) => void) => {
    const heard = (_event: unknown, update: unknown) => listener(update)
    ipcRenderer.on('update', heard)
    return () => ipcRenderer.removeListener('update', heard)
  },
  update: () => ipcRenderer.invoke('update:get'),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  untrust: (dir: string) => ipcRenderer.invoke('settings:untrust', dir),
  closeToEndpoint: (dir: string) => ipcRenderer.invoke('settings:close', dir),
  revealSettings: () => ipcRenderer.invoke('settings:reveal'),
  setNotifications: (on: boolean): Promise<boolean> => ipcRenderer.invoke('notify:set', on),
  setEditor: (command: string): Promise<string> => ipcRenderer.invoke('editor:set', command),
  openInEditor: (path: string, visible: number): Promise<void> => ipcRenderer.invoke('file:edit', path, visible),
  historyOf: (path: string) => ipcRenderer.invoke('file:history', path),
  compareFile: (path: string, hash: string | null) => ipcRenderer.invoke('file:compare', path, hash),
  onMinding: (listener: (left: number) => void) => {
    const heard = (_event: unknown, left: number) => listener(left)
    ipcRenderer.on('context:minding', heard)
    return () => ipcRenderer.removeListener('context:minding', heard)
  },
  isTrusted: (): Promise<boolean> => ipcRenderer.invoke('trust:get'),
  setTrusted: (yes: boolean): Promise<boolean> => ipcRenderer.invoke('trust:set', yes),
  isPrivate: (): Promise<boolean> => ipcRenderer.invoke('privacy:get'),
  setPrivate: (yes: boolean): Promise<boolean> => ipcRenderer.invoke('privacy:set', yes),
  isOpened: (): Promise<boolean> => ipcRenderer.invoke('privacy:opened'),
  setOpened: (yes: boolean): Promise<boolean> => ipcRenderer.invoke('privacy:open', yes),
  getEndpoint: () => ipcRenderer.invoke('endpoint:get'),
  setEndpoint: (url: string, model: string, key?: string) => ipcRenderer.invoke('endpoint:set', url, model, key),
  runScript: (project: string, line: string) => ipcRenderer.invoke('script:run', project, line),
  stopScript: () => ipcRenderer.invoke('script:stop'),
  checkAssist: () => ipcRenderer.invoke('assist:check'),
  runAssist: (task: 'rewrite' | 'note', passage: string, note: string) =>
    ipcRenderer.invoke('assist:run', task, passage, note)
})
