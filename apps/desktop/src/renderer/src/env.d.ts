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

/** Where a file stands in the context. The shelf is what is true now. A draft is a proposal. A pane is neither. */
export type Kind = 'shelf' | 'draft' | 'project' | 'context' | 'pane'

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
}

/** `present`: the helper is on this machine. `available`: the model behind it can answer now. */
export type AssistState = { present: boolean; available: boolean; reason: string }

export type MateApi = {
  openContext: () => Promise<{ dir: string; projects: string[] } | null>
  currentContext: () => Promise<{ dir: string; projects: string[] } | null>
  searchContext: (query: string) => Promise<Hit[]>
  readFile: (path: string) => Promise<FileView>
  openProject: (project: string, file?: string) => Promise<DocumentView>
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
  revertChange: (project: string, id: string, index: number) => Promise<Session>
  settleHeld: (project: string, id: string, index: number, approve: boolean) => Promise<Session>
  /** A kept change against the copy from before it, or a held change against the file as it is. */
  compare: (project: string, id: string, which: 'kept' | 'held', index: number) => Promise<Compared>
  onSession: (listener: (session: Session) => void) => () => void
  /** Whether the reader trusts the open context. In a trusted one Hermes runs as it does in a terminal. */
  isTrusted: () => Promise<boolean>
  /** Asks the reader in a system dialog before it gives trust. Returns what holds afterwards. */
  setTrusted: (yes: boolean) => Promise<boolean>
  checkAssist: () => Promise<AssistState>
  runAssist: (task: 'rewrite' | 'note', passage: string, note: string) => Promise<string>
}

declare global {
  interface Window {
    mate: MateApi
  }
}
