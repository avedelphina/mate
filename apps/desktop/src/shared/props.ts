import { propsOf } from './records'

/**
 * The fields of the front matter that Mate reads or that its template uses, with a line each, so the
 * reader who has forgotten them can see what a field does before adding it. `day` fields take a date.
 * Anything else a document says is the reader's own, and is offered from what other files use.
 */
export const KNOWN: { key: string; meaning: string; values?: string[]; day?: boolean }[] = [
  { key: 'tags', meaning: 'Names to find the document by. A slash nests one. Typed in the bar.' },
  { key: 'status', meaning: 'Where it stands. final makes a draft its project’s finished result.', values: ['final'] },
  { key: 'id', meaning: 'Makes the document a record, such as ADR-0001. Other documents can name it.' },
  { key: 'title', meaning: 'The name of a record in the lists.' },
  { key: 'owner', meaning: 'Who answers for it. A register item with no owner needs you.' },
  { key: 'due', meaning: 'The day it falls due. A record past it needs you.', day: true },
  { key: 'review', meaning: 'The day to look at it again.', day: true },
  { key: 'type', meaning: 'The kind of record, such as finding or deviation.' },
  { key: 'decision', meaning: 'The decision that covers a deviation: remediate, accept, change-target.' }
]

const DAY = /^\d{4}-\d{2}-\d{2}$/

export type PropUse = { key: string; count: number; values: string[] }

/**
 * The fields the documents of a context use, how many use each, and the values most used for it. It is
 * read from the text of the documents, so nothing is kept: the files say it. A value that is long or
 * empty is not offered, and a list or a map is counted for its key only.
 */
export function propsInUse(texts: string[]): PropUse[] {
  const seen = new Map<string, { count: number; values: Map<string, number> }>()
  for (const text of texts) {
    if (!text.startsWith('---')) continue
    for (const { key, value } of propsOf(text)) {
      const use = seen.get(key) ?? { count: 0, values: new Map() }
      use.count += 1
      if (value && value.length <= 60) use.values.set(value, (use.values.get(value) ?? 0) + 1)
      seen.set(key, use)
    }
  }
  return [...seen]
    .map(([key, use]) => ({
      key,
      count: use.count,
      // A key of dates offers no days: the picker does.
      values: [...use.values].filter(([value]) => !DAY.test(value)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([value]) => value)
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}
