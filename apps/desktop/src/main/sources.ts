import { randomBytes } from 'node:crypto'
import { statSync } from 'node:fs'
import path from 'node:path'

/** A file or a folder from outside the context that the window may ask for, by a number. */
export type Chosen = { id: string; name: string; where: string; markdown: boolean; folder: boolean }

/**
 * Give each path a number and remember it, as the window is told of what the reader picked in the
 * dialog or dropped on it. Only an absolute path that is there is kept: a thing that is not is left out.
 * The caller says where the paths come from. They are never a string the page wrote.
 */
export function keep(chosen: Map<string, string>, paths: unknown[]): Chosen[] {
  const kept: Chosen[] = []
  for (const each of paths) {
    if (typeof each !== 'string' || !path.isAbsolute(each)) continue
    const info = (() => {
      try {
        return statSync(each)
      } catch {
        return null
      }
    })()
    if (!info || !(info.isFile() || info.isDirectory())) continue
    const id = randomBytes(8).toString('hex')
    chosen.set(id, each)
    const folder = info.isDirectory()
    kept.push({ id, name: path.basename(each), where: each, markdown: !folder && each.toLowerCase().endsWith('.md'), folder })
  }
  return kept
}
