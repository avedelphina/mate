export type Reply = { text: string; author: string }

export type ReviewComment = {
  id: string
  anchor: string
  text: string
  author: string
  suggestion?: string
  replies: Reply[]
  resolved: boolean
}

/** `start` is where the quote sits in the document text. Null when the quote is no longer there. */
export type Thread = ReviewComment & { start: number | null }

/** A file in a project's `panes/` folder, written by an agent to be shown beside the draft. `written` is when. */
export type Pane = { name: string; text: string; written: number }

export type DocumentView = {
  project: string
  drafts: string[]
  file: string | null
  text: string
  comments: Thread[]
  intents: string
  principles: string
  panes: Pane[]
  /** Every file of the project, by its path from the project folder. */
  files: string[]
  /** Where the drafts are, from the project folder: `draft/`, or nothing when they are where they lie. */
  draftsIn: string
}

/**
 * Where a file stands in the context. The shelf is what is true now. A draft is a proposal. A project
 * file steers its project. Material is any other file of a project. A pane is what an agent gathered.
 */
export type Kind = 'shelf' | 'draft' | 'project' | 'material' | 'context' | 'pane'

/** A file that is read here and not reviewed: the shelf, a project's intents. */
/** `twin`: the text was taken out of a PDF or a Word file, and is read in place of it. */
export type FileView = { path: string; kind: Kind; project: string | null; text: string; twin?: boolean }

/** One place a search matched. `start` is where in the text of the file, or null. `thread` when it is in a comment. */
/** A commit that changed a file. `date` is ISO 8601. */
export type Commit = { hash: string; author: string; date: string; subject: string }

/** Where the update of the installed app is. `ready`: downloaded, on a Mac. `out`: a newer version, on Linux. */
export type Update = { state: 'idle' | 'checking' | 'none' | 'downloading' | 'ready' | 'out' | 'failed'; version?: string; message?: string }

/** What the settings page shows. Folders are as main holds them: real paths. */
export type Settings = {
  folder: string
  version: string
  /** The reader's editor command, or empty for the system's own app. */
  editor: string
  endpoint: { url: string; model: string; hasKey: boolean } | null
  trusted: string[]
  private: { dir: string; opened: boolean }[]
  /** Null when search by meaning can be had here, else what is missing. */
  meaning: string | null
  assist: AssistState
}

export type Hit = {
  path: string
  kind: Kind
  project: string | null
  title: string
  before: string
  match: string
  after: string
  start: number | null
  length: number
  thread: string | null
  /** The whole passage, as the file has it, for a hit found by meaning. */
  passage?: string
}

/** `mcp` is an agent the reader runs themselves. It comes in over MCP. */
export type AgentKind = 'claude' | 'codex' | 'hermes' | 'private' | 'mcp'
/** `host` is set for an agent on another machine, reached over SSH. */
export type AgentInfo = { kind: AgentKind; label: string; found: boolean; host: string | null }

/** `waiting`: sent while the agent was working, and not yet given to it. */
/** `cut`: Mate's note that the turn before it was cut off when the app was closed. */
export type Message = { role: 'you' | 'agent' | 'mate'; text: string; tools: string[]; waiting?: boolean; cut?: boolean }

/** One line of a comparison: kept, put in, or taken out. */
export type DiffLine = { kind: ' ' | '+' | '-'; text: string }

/** A context as the window is told of it. `shaped`: it has a folder for projects. `tracked`: it is in a git repository. */
export type Opened = { dir: string; projects: string[]; shaped: boolean; tracked: boolean }

/** What a change did or would do, as lines. A `note` when there are no lines to show. */
export type Compared = { lines?: DiffLine[]; note?: string }

/** Something an agent will not do until the reader says yes or no. `detail` is the command or the file. */
export type Ask = { id: string; title: string; detail: string }

/** A conversation with one agent inside one project. See src/main/sessions.ts. */
export type Session = {
  id: string
  project: string
  agent: AgentKind
  host: string | null
  created: string
  planApproved: boolean
  messages: Message[]
  /** What was sent while the agent was working. It goes to the agent when the turn has ended. */
  queue: { text: string; approve: boolean }[]
  /** Files the agent changed and Mate let through. */
  changes: { path: string; reverted: boolean }[]
  /** Changes Mate put back, waiting for the reader to approve that one file. */
  held: { path: string; state: 'waiting' | 'approved' | 'discarded' }[]
  running: boolean
  /** What the agent is asking right now. Only while a turn runs, and only from an agent that stays. */
  asks?: Ask[]
  /** The model and the thinking effort the reader chose. Without one, the agent's own. */
  model?: string
  effort?: string
}

/** A model an agent offers. `id` is the agent's name for it, `from` is who serves it. */
export type Model = { id: string; name: string; from: string }
export type Models = { current: string; all: Model[] }

/** What running a script came to. `output` is what it printed. `code` is null when it could not be started or was stopped. */
export type Ran = { line: string; code: number | null; output: string; seconds: number; stopped: boolean }

/** `present`: the helper is on this machine. `available`: the model behind it can answer now. */
export type AssistState = { present: boolean; available: boolean; reason: string }

export type MateApi = {
  openContext: () => Promise<Opened | null>
  /** Give the open folder the shape of a context. What is in it stays as it is. */
  shapeContext: () => Promise<Opened>
  /** Make the open context a git repository, where it is in none. Nothing is committed, and nothing connects. */
  trackContext: () => Promise<Opened>
  /** How many files of the context differ from the last commit. Only in a context the reader trusts. */
  countChanges: () => Promise<number>
  /** Put what has changed in the context into one commit. Gives the number of files. Only in a trusted context. */
  commit: (message: string) => Promise<number>
  /** A context in a folder that is not there yet. The reader names it and says where, in a dialog of the system. */
  newContext: () => Promise<Opened | null>
  /** A project in the open context: its folder, a place for drafts, its intents and its principles. */
  createProject: (name: string) => Promise<{ made: string; context: Opened }>
  /** Bring a folder in as a project: chosen and moved in dialogs of the system. Null when the reader did not. */
  importProject: () => Promise<{ made: string; context: Opened } | null>
  /** Give the open context a new name. Its folder is renamed, with all that is in it. */
  renameContext: (name: string) => Promise<Opened>
  /** Give a project a new name. Its folder and its sessions go with it. */
  renameProject: (from: string, name: string) => Promise<{ made: string; context: Opened }>
  /** The open context was renamed, from this window or another. */
  onMoved: (listener: (opened: Opened) => void) => () => void
  currentContext: () => Promise<Opened | null>
  searchContext: (query: string) => Promise<Hit[]>
  readFile: (path: string) => Promise<FileView>
  /** Show a file of the context in the system's file manager. It is not opened. */
  revealFile: (path: string) => Promise<void>
  openProject: (project: string, file?: string) => Promise<DocumentView>
  /** Tick a task box in a pane, or clear it. `at` is where the box is in `base`, the text that was shown. */
  tickPane: (project: string, name: string, base: string, at: number, draft?: string) => Promise<DocumentView>
  /** The documents of the shelf, by their path from the shelf folder. */
  listShelf: () => Promise<string[]>
  /** The files of the context outside the shelf and the projects: its dropbox, and anything else in it. */
  listContextFiles: () => Promise<string[]>
  /** Copy a shelf document into a project's drafts, to work on. The shelf keeps its own. */
  takeDown: (project: string, path: string) => Promise<DocumentView>
  /** Let the reader choose files and folders in the system dialog. Each comes back with a number that stands for its path. */
  pickSources: (near?: string) => Promise<{ id: string; name: string; where: string; markdown: boolean; folder: boolean }[]>
  /** Note where a file outside the context lies, in the project's dropbox. `source` is a number from pickSources, or a path. */
  noteSource: (project: string, source: string) => Promise<string>
  /** Copy a markdown file the reader chose into the project's drafts. */
  pullSource: (project: string, id: string) => Promise<DocumentView>
  /** Copy a folder the reader chose into the project, with all its folders. Gives its path in the context. */
  copyFolder: (project: string, id: string) => Promise<string>
  pathOf: (file: File) => string
  /** Move a document out of a dropbox into a project's drafts. */
  pullIn: (project: string, path: string) => Promise<DocumentView>
  /** Publish a draft as a named document of the shelf. The reader confirms in a system dialog. Null when they do not. */
  publishDraft: (project: string, file: string, name: string) => Promise<{ path: string; replaced: boolean } | null>
  /** Save what the reader typed. `base` is the text they began from: it is refused when the file holds another by now. */
  writeDraft: (project: string, file: string, base: string, text: string) => Promise<DocumentView>
  /** Start a new draft in a project. An existing file is never written over. */
  createDraft: (project: string, name: string) => Promise<DocumentView>
  addComment: (
    project: string,
    file: string,
    anchor: string,
    text: string,
    author: string,
    from?: number,
    suggestion?: string
  ) => Promise<DocumentView>
  addReply: (project: string, file: string, id: string, text: string, author: string) => Promise<DocumentView>
  applySuggestion: (project: string, file: string, id: string) => Promise<DocumentView>
  anchorComment: (project: string, file: string, id: string, anchor: string, from?: number) => Promise<DocumentView>
  /** The agents on this computer, found on the PATH; the ones on other machines the reader added; and their own agent. */
  listAgents: () => Promise<AgentInfo[]>
  /** The hosts in the ssh config, as agents to add. Adds nothing. */
  discoverAgents: () => Promise<AgentInfo[]>
  /** Both return the agents on other machines afterwards. */
  addAgent: (kind: AgentKind, host: string) => Promise<AgentInfo[]>
  removeAgent: (kind: AgentKind, host: string) => Promise<AgentInfo[]>
  /** Point the MCP door at this session. Returns where the reader's own agent connects. */
  bindMcp: (project: string, id: string) => Promise<{ url: string; token: string }>
  listSessions: (project: string) => Promise<Session[]>
  startSession: (project: string, agent: AgentKind, host?: string) => Promise<Session>
  /** `wait`: sent while the agent works, it is to go when the turn has ended, even to an agent that would take it into the turn. */
  sendMessage: (project: string, id: string, text: string, approve: boolean, wait?: boolean) => Promise<Session>
  stopTurn: (id: string) => Promise<void>
  /** Yes or no to what the agent asked. Yes is for that one thing, once. */
  answerAsk: (id: string, ask: string, allow: boolean) => Promise<void>
  /** What Hermes on this computer offers to think with. Hermes is started to be asked, the first time. */
  listModels: () => Promise<Models>
  /** The model and the effort of a conversation, from its next turn on. Null gives the choice back to the agent. */
  tuneSession: (project: string, id: string, model: string | null, effort: string | null) => Promise<Session>
  revertChange: (project: string, id: string, index: number) => Promise<Session>
  settleHeld: (project: string, id: string, index: number, approve: boolean) => Promise<Session>
  /** A kept change against the copy from before it, or a held change against the file as it is. */
  compare: (project: string, id: string, which: 'kept' | 'held', index: number) => Promise<Compared>
  onSession: (listener: (session: Session) => void) => () => void
  /** The passages closest in meaning to a question. `missing` says what this computer lacks for it, when it does. */
  searchMeaning: (query: string, limit?: number) => Promise<{ missing: string | null; hits: Hit[] }>
  /** The host of the reader's endpoint, when it may judge passages of the open context. */
  judgingHost: () => Promise<string | null>
  /** Of the thirty passages closest in meaning, those the reader's endpoint picks as answering the question, in its order. */
  judge: (question: string, leave?: { path: string; start: number; end: number }) => Promise<{ asked: number; hits: Hit[] }>
  /** How many files of the open context are still to be given their meaning. */
  onMinding: (listener: (left: number) => void) => () => void
  /** How many PDF and Word files of the open context are still to be read, so that search finds them. */
  onReading: (listener: (left: number) => void) => () => void
  /** Settings… in the app menu. */
  onSettings: (listener: () => void) => () => void
  /** Everything the reader has set, and what this computer has. Never the key. */
  settings: () => Promise<Settings>
  onUpdate: (listener: (update: Update) => void) => () => void
  update: () => Promise<Update>
  /** Ask GitHub now. On a Mac the answer comes through `onUpdate`. */
  checkForUpdate: () => Promise<Update>
  /** On a Mac, restart into the downloaded version. On Linux, open the page to download it from. */
  installUpdate: () => Promise<void>
  /** Trust no more a context on the list. Taking away asks nothing. */
  untrust: (dir: string) => Promise<void>
  /** Close a private context on the list to the reader's endpoint. */
  closeToEndpoint: (dir: string) => Promise<void>
  /** The folder the settings are kept in, in the file manager. */
  revealSettings: () => Promise<string>
  /** The reader's editor, as a command: the program and what it is given first. Empty: the system's own app. */
  setEditor: (command: string) => Promise<string>
  /** Open a file of the context in the reader's editor, at the line of a place in the text the page shows. */
  openInEditor: (path: string, visible: number) => Promise<void>
  /** The commits that changed a file, and whether it changed since the last. In a context the reader trusts. */
  historyOf: (path: string) => Promise<{ repository: boolean; commits: Commit[]; changed: boolean }>
  /** What changed in a file: since the last commit (null), or in one commit. */
  compareFile: (path: string, hash: string | null) => Promise<{ kind: ' ' | '+' | '-'; text: string }[]>
  /** Whether the reader trusts the open context. In a trusted one Hermes runs as it does in a terminal. */
  isTrusted: () => Promise<boolean>
  /** Asks the reader in a system dialog before it gives trust. Returns what holds afterwards. */
  setTrusted: (yes: boolean) => Promise<boolean>
  /** Whether the open context is private: no agent works in it, so nothing of it leaves this computer. */
  isPrivate: () => Promise<boolean>
  /** Keeping it private asks nothing. Letting agents in again asks in a system dialog. Returns what holds afterwards. */
  setPrivate: (yes: boolean) => Promise<boolean>
  /** Whether the open private context may be read by Hermes on the reader's own endpoint. */
  isOpened: () => Promise<boolean>
  /** Opening asks in a system dialog that names the host. Returns what holds afterwards. */
  setOpened: (yes: boolean) => Promise<boolean>
  /** The reader's endpoint: its address and model, and whether a key is saved. Never the key. */
  getEndpoint: () => Promise<{ url: string; model: string; hasKey: boolean } | null>
  /** Save the endpoint. An empty key keeps the saved one, unless the host changed. */
  setEndpoint: (url: string, model: string, key?: string) => Promise<{ url: string; model: string; hasKey: boolean } | null>
  /** Run a script of the project: `scripts/NAME`, then what it is given. Only in a context the reader trusts. No agent. */
  runScript: (project: string, line: string) => Promise<Ran>
  /** Stop the script that is running in this context. */
  stopScript: () => Promise<void>
  checkAssist: () => Promise<AssistState>
  runAssist: (task: 'rewrite' | 'note', passage: string, note: string) => Promise<string>
}

declare global {
  interface Window {
    mate: MateApi
  }
}
