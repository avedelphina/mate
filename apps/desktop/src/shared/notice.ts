/** What a session needed from the reader the last time Mate looked: to see what is new. */
export type Seen = { running: boolean; asks: number; held: number }

export const seenOf = (session: { running: boolean; asks?: unknown[]; held: { state: string }[] }): Seen => ({
  running: session.running,
  asks: (session.asks ?? []).length,
  held: session.held.filter((each) => each.state === 'waiting').length
})

/**
 * The words for the reader when something new needs them, or null. A question comes first, then a
 * held file, then the end of a turn. Nothing of a document is in them.
 */
export function noticeFor(before: Seen | undefined, now: Seen, planApproved: boolean): string | null {
  if (!before) return null
  if (now.asks > before.asks) return 'Is asking you something.'
  if (now.held > before.held) return 'Wants to change a file. It is held for you.'
  if (before.running && !now.running) return planApproved ? 'Has finished.' : 'Has a plan for you to approve.'
  return null
}
