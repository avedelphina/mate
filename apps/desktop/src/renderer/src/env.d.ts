import type { RecordRow } from '../../shared/records'
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
  folders: string[]
  /** The drafts that say `status: final`. */
  final: string[]
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

/** An open pull request on the reader's Gitea or GitHub. `head` and `base` are its branches. */
export type Pull = { number: number; title: string; author: string; head: string; base: string }

/** The pull request a project is checked out on. `back` is the branch or commit it was on before. `base` is the commit it branched from. */
export type Review = { number: number; title: string; url: string; head: string; headRef: string; base: string; baseRef: string; back: string; files: string[] }

/** A Gitea or GitHub the reader added. `user`: whose its token is, when the forge said. Never the token. */
export type Forge = { url: string; kind: 'gitea' | 'github'; user: string | null }

/** What the forge says of a pull request. `pending`: how many comments are to be sent, or why none can be. */
export type Pulls = {
  /** Gitea or GitHub. */
  forge: string
  host: string
  repo: string
  pulls: Pull[]
  review: Review | null
  verdicts: { author: string; state: string; body: string; stale: boolean }[]
  pending: number | string
  /** The files whose text the reader changed, to be committed to the pull request first. */
  edited: string[]
  /** The pull request's branch is on a fork, where Mate does not push. */
  fork: boolean
}

/** What the settings page shows. Folders are as main holds them: real paths. */
export type Settings = {
  folder: string
  version: string
  /** The reader's editor command, or empty for the system's own app. */
  editor: string
  /** Whether the reader is told, outside the window, when an agent needs them. */
  notifications: boolean
  endpoint: { url: string; model: string; hasKey: boolean } | null
  /** The forges the reader added. Never a token. */
  forges: Forge[]
  firecrawl: { hasKey: boolean; base: string }
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
export type AgentKind = 'claude' | 'codex' | 'kimi' | 'hermes' | 'private' | 'mcp'
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
export type Ask = { id: string; title: string; detail: string; choices?: { id: string; name: string }[]; kind?: string }

/** What the reader let an agent do in a conversation without asking again: kinds of step, or everything. */
export type Auto = { all: boolean; kinds: string[] }

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
  /** What the reader let the agent do without asking. It lasts until Mate is closed. */
  auto?: Auto
  /** The model and the thinking effort the reader chose. Without one, the agent's own. */
  model?: string
  effort?: string
}

/** A model an agent offers. `id` is the agent's name for it, `from` is who serves it. */
export type Model = { id: string; name: string; from: string }
export type Models = { current: string; all: Model[]; efforts?: string[] }

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
  /** The version, and the contexts opened last, newest first, for the window that has none open. `shown` is the folder as the reader knows it. */
  recentContexts: () => Promise<{ version: string; recent: { name: string; dir: string; shown: string }[] }>
  /** Open one of the contexts opened last. Main opens only one that is on its list. */
  reopenContext: (dir: string) => Promise<Opened>
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
  contextTags: () => Promise<{ tag: string; count: number }[]>
  /** The tags each file of a project names, by its path from the project. Only files that name one. */
  projectTags: (project: string) => Promise<Record<string, string[]>>
  readFile: (path: string) => Promise<FileView>
  /** Show a file of the context in the system's file manager. It is not opened. */
  revealFile: (path: string) => Promise<void>
  /** A menu of the system, under the pointer or at `at` in the window. `null` is a line between items. Gives the id of the chosen item, or null. */
  menu: (items: ({ id: string; label: string; enabled?: boolean } | null)[], at?: { x: number; y: number }) => Promise<string | null>
  openProject: (project: string, file?: string) => Promise<DocumentView>
  /** Tick a task box in a pane, or clear it. `at` is where the box is in `base`, the text that was shown. */
  readNote: (project: string, file: string) => Promise<string>
  writeNote: (project: string, file: string, base: string, text: string) => Promise<string>
  makeFolder: (project: string, where: string) => Promise<DocumentView>
  tickPane: (project: string, name: string, base: string, at: number, draft?: string) => Promise<DocumentView>
  writeSteering: (project: string, name: string, base: string, text: string, draft?: string) => Promise<DocumentView>
  /** The documents of the shelf, by their path from the shelf folder. */
  listShelf: () => Promise<string[]>
  /** The files of the context outside the shelf and the projects: its dropbox, and anything else in it. */
  listContextFiles: () => Promise<string[]>
  /** Copy a shelf document into a project's drafts, to work on. The shelf keeps its own. */
  takeDown: (project: string, path: string) => Promise<DocumentView>
  /** Let the reader choose files and folders in the system dialog. Each comes back with a number that stands for its path. */
  /** Files dropped on the window, each with a number, as if the reader had picked them in the dialog. */
  takeDropped: (files: File[]) => Promise<{ id: string; name: string; where: string; markdown: boolean; folder: boolean }[]>
  pickSources: (near?: string) => Promise<{ id: string; name: string; where: string; markdown: boolean; folder: boolean }[]>
  /** Note where a file outside the context lies, in the project's dropbox. `source` is a number from pickSources or takeDropped. */
  noteSource: (project: string, source: string) => Promise<string>
  /** Copy a markdown file the reader chose into the project's drafts. */
  pullSource: (project: string, id: string) => Promise<DocumentView>
  /** Copy a folder the reader chose into the project, with all its folders. Gives its path in the context. */
  copyFolder: (project: string, id: string) => Promise<string>
  /** Move a document out of a dropbox into a project's drafts. */
  pullIn: (project: string, path: string) => Promise<DocumentView>
  /** Publish a draft as a named document of the shelf. The reader confirms in a system dialog. Null when they do not. */
  publishDraft: (project: string, file: string, name: string) => Promise<{ path: string; replaced: boolean } | null>
  /** Save what the reader typed. `base` is the text they began from: it is refused when the file holds another by now. */
  writeDraft: (project: string, file: string, base: string, text: string) => Promise<DocumentView>
  /** Start a new draft in a project. An existing file is never written over. */
  /** `template` is a file of the context's templates/ folder. Without it, the draft is its name as a heading. */
  createDraft: (project: string, name: string, folder?: string, template?: string) => Promise<DocumentView>
  /** The markdown files in the context's templates/ folder. */
  listTemplates: () => Promise<string[]>
  /** Start a file in any folder of a project, `folder` counted from the project folder. An existing file is never written over. */
  createFile: (project: string, name: string, folder?: string) => Promise<DocumentView>
  /** The path of the request in the other project's dropbox, or null when the reader said no. */
  sendToProject: (project: string, file: string, target: string, passage: string, note: string) => Promise<string | null>
  /** A draft made of the text of a file, with no agent: a file of the project by its path, or one chosen in the dialog by its number. */
  /** Fetch a web page through the reader's Firecrawl and write it as a draft, with its address at the top. Not in a private context. */
  addLink: (project: string, link: string) => Promise<DocumentView>
  /** The reader's Firecrawl: whether a key is saved and where it asks. Never the key. */
  getFirecrawl: () => Promise<{ hasKey: boolean; base: string }>
  /** Try the key, then save it. Firecrawl refusing it is an error and nothing is saved. An empty key keeps the saved one, unless the address changed. An empty address is Firecrawl's cloud. `checked` says what the try found. */
  setFirecrawl: (key: string | undefined, base: string) => Promise<{ hasKey: boolean; base: string; checked: string }>
  extractSource: (project: string, how: 'path' | 'id', value: string) => Promise<DocumentView>
  moveFile: (project: string, from: string, to: string) => Promise<DocumentView>
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
  /** Write these tags into the front matter of a document: where its tags were, or in a block made at the top. */
  setTags: (project: string, file: string, tags: string[]) => Promise<DocumentView>
  /** One field of the front matter, set to a word. The comment after it is kept. */
  setField: (project: string, file: string, key: string, value: string) => Promise<DocumentView>
  /** The records of a project, and what each ID in a text opens, by path from the project. */
  projectRecords: (project: string) => Promise<{ records: RecordRow[]; refs: Record<string, string> }>
  /** A record made with the repository's own tool. Where it is, from the project. Trusted contexts only. */
  newRecord: (project: string, kind: string, title: string, type?: string) => Promise<string>
  /** Word files built with the repository's own tool. Where they are, from the project. Trusted contexts only. */
  buildDocuments: (project: string, target: string) => Promise<{ built: string[]; output: string }>
  applySuggestion: (project: string, file: string, id: string) => Promise<DocumentView>
  editComment: (project: string, file: string, id: string, text: string, reply?: number) => Promise<DocumentView>
  removeComment: (project: string, file: string, id: string, reply?: number) => Promise<DocumentView>
  resolveComment: (project: string, file: string, id: string, resolved: boolean) => Promise<DocumentView>
  anchorComment: (project: string, file: string, id: string, anchor: string, from?: number) => Promise<DocumentView>
  /** The Gitea and GitHub hosts the reader added, to review pull requests on. A token is sealed by the keychain and never shown again. */
  listForges: () => Promise<Forge[]>
  /** Tries the token on the forge first: one it does not know, or that cannot write to a repository, is refused. */
  addForge: (url: string, token: string) => Promise<Forge[]>
  removeForge: (url: string) => Promise<Forge[]>
  /** The pull request the project is checked out on, from its files. Nothing connects. */
  reviewing: (project: string) => Promise<Review | null>
  /** Asks the project's forge for its open pull requests, and what was said of the one under review. */
  listPulls: (project: string) => Promise<Pulls>
  /** Check out a pull request, and put its conversations on the forge in the margin. In a context the reader trusts. */
  takePull: (project: string, number: number) => Promise<Review>
  /** What the pull request changed in one of its files, against the commit it branched from. */
  pullChanges: (project: string, path: string) => Promise<DiffLine[]>
  /** Post the comments as one review on the forge. The reader confirms in a system dialog. Null when they do not, else how many comments went. */
  sendReview: (project: string, verdict: 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVED', body: string) => Promise<number | null>
  /** Commit the text the reader changed to the pull request's branch, and push it, after a system dialog. Null when they did not. */
  commitToPull: (project: string, message: string) => Promise<{ files: string[]; branch: string } | null>
  /** Words for the commit, from the on-device model, out of the reader's change. Nothing is committed. */
  draftCommit: (project: string) => Promise<string>
  /** The forge merges the pull request, after a system dialog, and the project goes back to where it was. Null when the reader did not. */
  mergePull: (project: string) => Promise<{ number: number; base: string; moved: boolean } | null>
  /** Go back to where the project was. Refused while comments are not sent. */
  leavePull: (project: string) => Promise<Review>
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
  /** `choice` is the answer to a question that has answers to pick from. Without one, `allow` is a plain yes or no. */
  answerAsk: (id: string, ask: string, allow: boolean, choice?: string, scope?: 'kind' | 'all') => Promise<void>
  allowNoMore: (project: string, id: string) => Promise<Session>
  /** What Hermes on this computer offers to think with. Hermes is started to be asked, the first time. */
  listModels: (agent: 'hermes' | 'kimi') => Promise<Models>
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
  setNotifications: (on: boolean) => Promise<boolean>
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
