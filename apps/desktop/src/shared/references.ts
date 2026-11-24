/** A thing outside a context that agents are told of: where it lies, and when to look there. See main/references.ts. */
export type Reference = { name: string; path: string; about: string; kind: 'folder' | 'file' }

/**
 * What a link names, when it names a reference: `[[antifragile]]`, or `[[antifragile/principles.md]]` for
 * something inside a folder. `inside` is the path under the reference, with no way out of it. A document of
 * the context is looked for first, so this is asked only when none has the name.
 */
export function referenceNamed<T extends { name: string; kind: 'folder' | 'file' }>(list: T[], target: string): { reference: T; inside: string } | null {
  const parts = String(target).trim().replace(/\\/g, '/').replace(/^\.?\//, '').split('/')
  const found = list.find((each) => each.name.toLowerCase() === parts[0].toLowerCase())
  if (!found) return null
  const rest = parts.slice(1)
  if (rest.length > 0 && (found.kind === 'file' || rest.some((part) => part === '' || part === '..'))) return null
  return { reference: found, inside: rest.join('/') }
}
