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
}

/**
 * Where a file stands in the context. The shelf is what is true now. A draft is a proposal. A project
 * file steers its project. Material is any other file of a project. A pane is what an agent gathered.
 */
export type Kind = 'shelf' | 'draft' | 'project' | 'material' | 'context' | 'pane'

/** A file that is read here and not reviewed: the shelf, a project's intents. */
export type FileView = { path: string; kind: Kind; project: string | null; text: string }

/** One place a search matched. `start` is where in the text of the file, or null. `thread` when it is in a comment. */
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
}

/** `mcp` is an agent the reader runs themselves. It comes in over MCP. */
export type AgentKind = 'claude' | 'codex' | 'hermes' | 'mcp'
/** `host` is set for an agent on another machine, reached over SSH. */
export type AgentInfo = { kind: AgentKind; label: string; found: boolean; host: string | null }

/** `waiting`: sent while the agent was working, and not yet given to it. */
export type Message = { role: 'you' | 'agent' | 'mate'; text: string; tools: string[]; waiting?: boolean }

/** One line of a comparison: kept, put in, or taken out. */
export type DiffLine = { kind: ' ' | '+' | '-'; text: string }

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
  openContext: () => Promise<{ dir: string; projects: string[] } | null>
  /** A context in a folder that is not there yet. The reader names it and says where, in a dialog of the system. */
  newContext: () => Promise<{ dir: string; projects: string[] } | null>
  /** A project in the open context: its folder, a place for drafts, its intents and its principles. */
  createProject: (name: string) => Promise<{ made: string; projects: string[] }>
  currentContext: () => Promise<{ dir: string; projects: string[] } | null>
  searchContext: (query: string) => Promise<Hit[]>
  readFile: (path: string) => Promise<FileView>
  /** Show a file of the context in the system's file manager. It is not opened. */
  revealFile: (path: string) => Promise<void>
  openProject: (project: string, file?: string) => Promise<DocumentView>
  /** Tick a task box in a pane, or clear it. `at` is where the box is in `base`, the text that was shown. */
  tickPane: (project: string, name: string, base: string, at: number, draft?: string) => Promise<DocumentView>
  /** The documents of the shelf, by their path from the shelf folder. */
  listShelf: () => Promise<string[]>
  /** Copy a shelf document into a project's drafts, to work on. The shelf keeps its own. */
  takeDown: (project: string, path: string) => Promise<DocumentView>
  /** Let the reader choose files in the system dialog. Each comes back with a number that stands for its path. */
  pickSources: (near?: string) => Promise<{ id: string; name: string; where: string; markdown: boolean }[]>
  /** Note where a file outside the context lies, in the project's dropbox. `source` is a number from pickSources, or a path. */
  noteSource: (project: string, source: string) => Promise<string>
  /** Copy a markdown file the reader chose into the project's drafts. */
  pullSource: (project: string, id: string) => Promise<DocumentView>
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
  listAgents: () => Promise<AgentInfo[]>
  /** Point the MCP door at this session. Returns where the reader's own agent connects. */
  bindMcp: (project: string, id: string) => Promise<{ url: string; token: string }>
  listSessions: (project: string) => Promise<Session[]>
  startSession: (project: string, agent: AgentKind, host?: string) => Promise<Session>
  sendMessage: (project: string, id: string, text: string, approve: boolean) => Promise<Session>
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
  /** Whether the reader trusts the open context. In a trusted one Hermes runs as it does in a terminal. */
  isTrusted: () => Promise<boolean>
  /** Asks the reader in a system dialog before it gives trust. Returns what holds afterwards. */
  setTrusted: (yes: boolean) => Promise<boolean>
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
