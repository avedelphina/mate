/**
 * The line of a run button may leave something open: a word in curly brackets, such as `{file}`,
 * is asked of the reader before the script runs. What they give becomes one thing the script is
 * given, spaces and all.
 */

const OPEN = /\{([^{}\s]+)\}/g

/** The names the line asks for, each once, in the order they come. */
export function asked(line: string): string[] {
  return [...new Set([...line.matchAll(OPEN)].map((found) => found[1]))]
}

/** The line with what the reader gave in place of each name. It throws when something is missing or cannot be given. */
export function filled(line: string, given: Record<string, string>): string {
  return line.replace(OPEN, (_, name: string) => {
    const value = (given[name] ?? '').trim()
    if (!value) throw new Error(`Say what ${name} is.`)
    // The line is split at spaces, with double quotes around what has a space. So a quote itself cannot be given.
    if (value.includes('"')) throw new Error('A double quote cannot be given to a script this way.')
    return /\s/.test(value) ? `"${value}"` : value
  })
}
