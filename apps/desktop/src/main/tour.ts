import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * The tour: a small context that is itself the tutorial, shipped inside the app in `tour/` and copied to a
 * folder the reader chooses. It is documents, a pane and a table, and no program, so it needs no trust.
 *
 * It is copied file by file with the functions that read inside the app's archive, which `fs.cp` does not.
 * What Mate keeps in a hidden folder is shipped as `mate-private/`, since a build may leave out hidden
 * folders, and is given its name, `.mate/`, on the way.
 */
export async function copyTour(from: string, to: string): Promise<void> {
  if (existsSync(to)) throw new Error('Something of that name is already there. Choose another name.')
  const copy = async (source: string, target: string): Promise<void> => {
    await mkdir(target, { recursive: true })
    for (const entry of await readdir(source, { withFileTypes: true })) {
      const name = target === to && entry.name === 'mate-private' ? '.mate' : entry.name
      if (entry.isDirectory()) await copy(path.join(source, entry.name), path.join(target, name))
      else if (entry.isFile()) await writeFile(path.join(target, name), await readFile(path.join(source, entry.name)))
    }
  }
  await copy(from, to)
}
