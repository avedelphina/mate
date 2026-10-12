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

export type DocumentView = {
  project: string
  drafts: string[]
  file: string | null
  text: string
  comments: Thread[]
  intents: string
  principles: string
}

/** Where a file stands in the context. The shelf is what is true now. A draft is a proposal. */
export type Kind = 'shelf' | 'draft' | 'project' | 'context'

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
  checkAssist: () => Promise<AssistState>
  runAssist: (task: 'rewrite' | 'note', passage: string, note: string) => Promise<string>
}

declare global {
  interface Window {
    mate: MateApi
  }
}
