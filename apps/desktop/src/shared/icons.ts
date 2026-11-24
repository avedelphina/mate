/**
 * What a folder of a project can be marked with in the rail: one of Mate's own line pictures, or one emoji.
 * Nothing else: a picture or an SVG from a context is never drawn, so an icon cannot carry code. The
 * choice is the reader's and is kept in the context's private folder, so this is checked where it is read
 * as well as where it is set: a file there may have been written by anything.
 */
export const FOLDER_ICONS = ['folder', 'project', 'shelf', 'context', 'dropbox', 'pane', 'script', 'text', 'intents', 'principles', 'tag', 'commit'] as const
export type FolderIcon = (typeof FOLDER_ICONS)[number]

export const isBuiltIn = (value: string): value is FolderIcon => (FOLDER_ICONS as readonly string[]).includes(value)

const PICTURE = /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u

/** The icon a value stands for, or null: a name Mate knows, or one emoji with its joiners and tone, as one mark. */
export function iconOf(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text === '' || text.length > 32) return null
  if (isBuiltIn(text)) return text
  const marks = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)]
  return marks.length === 1 && PICTURE.test(text) ? text : null
}

/** The icons a file of them says, each for a path of the project. What is not an icon, or not a path, is left out. */
export function iconsIn(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const found: Record<string, string> = {}
  for (const [folder, value] of Object.entries(raw)) {
    const icon = iconOf(value)
    if (icon && folder !== '' && !folder.split('/').some((part) => part === '' || part === '..' || part.startsWith('.'))) found[folder] = icon
  }
  return found
}
