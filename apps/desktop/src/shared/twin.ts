/**
 * The kinds of file whose text Mate takes out and keeps, so that search, the page and agents can
 * read them: PDF, and what the system's text converter reads, Word among it. The text of one is
 * its twin, kept in `.indexes/text/` under the file's own path with `.txt` added.
 */
export const TWINNED = ['.pdf', '.docx', '.doc', '.rtf', '.odt', '.html', '.htm', '.webarchive']

export const isTwinned = (path: string): boolean => {
  const lower = path.toLowerCase()
  return TWINNED.some((ending) => lower.endsWith(ending))
}

/** Where the twin of a file of the context is, from the context folder. */
export const twinOf = (path: string): string => `.indexes/text/${path}.txt`
