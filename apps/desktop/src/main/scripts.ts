import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { agentEnvironment } from './agents'
import { realInside, resolveInside } from './context'
import { isBusy } from './sessions'
import { isTrusted } from './trust'

/**
 * Run a script of a project, when the reader presses its button. No agent is involved, and nothing
 * leaves the computer: the script is a file in the project's `scripts/` folder, started as its own
 * process in the project folder.
 *
 * A script is a program with the reader's rights. So it runs only in a context the reader trusts,
 * only from `scripts/`, and only as the line the button shows: the file, then its arguments. There
 * is no shell in between, so nothing in an argument is read as a command.
 */

/** What a run came to. `output` is what the script printed, both streams, in the order it came. */
export type Ran = { line: string; code: number | null; output: string; seconds: number; stopped: boolean }

// ponytail: fixed limits. A script that prints more, or runs longer, is cut off and says so.
const MAX_OUTPUT = 64 * 1024
const MAX_SECONDS = 300

/** What starts a script, by the ending of its name. Any other file must be one the system can start itself. */
const STARTERS: Record<string, string> = { '.py': 'python3', '.sh': 'sh', '.js': 'node', '.mjs': 'node' }

/** The words of a line: split at spaces, with "double quotes" around a word that has a space in it. */
export function wordsOf(line: string): string[] {
  return [...String(line).matchAll(/"([^"]*)"|(\S+)/g)].map((found) => found[1] ?? found[2])
}

/** The scripts that are running, by context, so that one can be stopped and two do not run at once. */
const running = new Map<string, () => void>()

export const stopScript = (contextDir: string): void => running.get(contextDir)?.()

/** When the app is quit, no script is left running behind it. */
export const stopAllScripts = (): void => running.forEach((stop) => stop())

export async function runScript(contextDir: string, project: string, line: string, seconds = MAX_SECONDS): Promise<Ran> {
  if (!isTrusted(contextDir)) throw new Error('A script runs only in a context you trust. Trust this context in the Agent tab first.')
  if (running.has(contextDir)) throw new Error('A script is running in this context. Wait for it, or stop it.')
  // The guard would take what the script changes for the agent's, and put it back.
  if (isBusy(contextDir)) throw new Error('An agent is working in this context. Run the script when it has finished.')
  // The place is taken at once, before anything is waited for, so that a second press finds it taken.
  let stopped = false
  let halt = () => {
    stopped = true
  }
  running.set(contextDir, () => halt())
  try {
    const [script, ...args] = wordsOf(line)
    const parts = (script ?? '').split('/')
    if (parts[0] !== 'scripts' || parts.length < 2 || parts.some((part) => part === '' || part.startsWith('.'))) {
      throw new Error('Only a script in the scripts folder of this project is run: scripts/NAME, then what it is given.')
    }
    const projectDir = resolveInside(contextDir, 'projects', project)
    // Where the file really is: a link in scripts/ that points out of the context is not run.
    const file = await realInside(contextDir, 'projects', project, ...parts)
    if (!(await stat(file)).isFile()) throw new Error('That is not a script.')
    const starter = STARTERS[path.extname(file).toLowerCase()]

    const began = Date.now()
    return await new Promise<Ran>((resolve) => {
      // In a group of its own, so that stopping it stops what it started too, such as a `sleep` in a shell script.
      const child = spawn(starter ?? file, starter ? [file, ...args] : args, {
        cwd: projectDir,
        env: agentEnvironment(),
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true
      })
      const kill = () => {
        try {
          process.kill(-child.pid!)
        } catch {
          child.kill()
        }
      }
      let output = ''
      const take = (chunk: Buffer) => {
        if (output.length < MAX_OUTPUT) output = (output + chunk.toString()).slice(0, MAX_OUTPUT)
      }
      halt = () => {
        stopped = true
        kill()
      }
      // Stopped while it was being found: it does not get to run.
      if (stopped) kill()
      const late = setTimeout(() => halt(), seconds * 1000)
      child.stdout.on('data', take)
      child.stderr.on('data', take)
      const done = (code: number | null, note = '') => {
        clearTimeout(late)
        resolve({ line, code, output: output + note, seconds: Math.round((Date.now() - began) / 100) / 10, stopped })
      }
      child.on('error', (error) => done(null, `Could not start it: ${error.message}`))
      child.on('close', (code) => done(code))
    })
  } finally {
    running.delete(contextDir)
  }
}
