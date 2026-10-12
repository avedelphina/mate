export type ReviewComment = {
  id: string
  anchor: string
  text: string
  author: string
}

export type DocumentView = {
  project: string
  file: string
  markdown: string
  comments: ReviewComment[]
  intents: string
  principles: string
}

export type MateApi = {
  openContext: () => Promise<{ dir: string; projects: string[] } | null>
  openProject: (project: string, file?: string) => Promise<DocumentView>
  addComment: (project: string, file: string, anchor: string, text: string, author: string) => Promise<DocumentView>
}

declare global {
  interface Window {
    mate: MateApi
  }
}
