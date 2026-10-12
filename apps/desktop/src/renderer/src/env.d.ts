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

export type MateApi = {
  openContext: () => Promise<{ dir: string; projects: string[] } | null>
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
}

declare global {
  interface Window {
    mate: MateApi
  }
}
