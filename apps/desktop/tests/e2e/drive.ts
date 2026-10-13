import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * Start the built app on a context folder and drive its window. No framework: Electron is asked
 * for a debugging port, and the page is spoken to over it with what Node has, as a browser's own
 * tools would. The app gets a data folder of its own, so it sees none of the reader's.
 *
 * Clicks are made in the page, not with the mouse, so they work while the window is covered.
 */
export async function launch(contextDir: string, kept: Record<string, string> = {}) {
  const app = path.resolve(import.meta.dirname, '../..')
  const userData = await mkdtemp(path.join(tmpdir(), 'mate-e2e-data-'))
  // What the app is to find in its data folder, as if the reader had said it on an earlier day.
  for (const [name, text] of Object.entries(kept)) await writeFile(path.join(userData, name), text)
  // Required from Node, the electron package is the path of its program.
  const electron = createRequire(import.meta.url)('electron') as unknown as string
  const env = { ...process.env }
  // Set by some editors' terminals. With it Electron would run as plain Node, and the dev server is not wanted here.
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  const child = spawn(electron, [app, '--remote-debugging-port=0', `--user-data-dir=${userData}`, contextDir], { env })

  const port = await new Promise<number>((resolve, reject) => {
    let said = ''
    const late = setTimeout(() => reject(new Error(`The app did not start.\n${said}`)), 20_000)
    child.stderr.on('data', (chunk: Buffer) => {
      said += chunk.toString()
      const found = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(said)
      if (found) (clearTimeout(late), resolve(Number(found[1])))
    })
    child.on('exit', () => reject(new Error(`The app stopped at once. Was it built? Run pnpm build.\n${said}`)))
  })

  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  let target: { webSocketDebuggerUrl: string } | undefined
  for (let waited = 0; !target && waited < 10_000; waited += 200) {
    const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[]
    target = targets.find((each) => each.type === 'page')
    if (!target) await pause(200)
  }
  if (!target) throw new Error('The app opened no window.')
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => ((socket.onopen = resolve), (socket.onerror = reject)))
  let next = 0
  const waiting = new Map<number, (reply: any) => void>() // eslint-disable-line @typescript-eslint/no-explicit-any
  socket.onmessage = (event) => {
    const reply = JSON.parse(String(event.data))
    waiting.get(reply.id)?.(reply)
  }

  /** Run an expression in the page and give back its value. */
  const page = <T = unknown>(expression: string): Promise<T> =>
    new Promise((resolve, reject) => {
      const id = ++next
      waiting.set(id, (reply) => {
        const failed = reply.result?.exceptionDetails
        if (failed) reject(new Error(failed.exception?.description ?? failed.text))
        else resolve(reply.result?.result?.value as T)
      })
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
    })

  /** Wait until an expression in the page is true. `what` says what was waited for, when it never comes. */
  const until = async (expression: string, what: string): Promise<void> => {
    for (let waited = 0; waited < 10_000; waited += 100) {
      if (await page(expression)) return
      await pause(100)
    }
    throw new Error(`It did not happen: ${what}`)
  }

  /** Press the first element that matches `selector` and reads exactly `text`. */
  const press = async (selector: string, text: string): Promise<void> => {
    const pressed = await page(
      `(() => { const found = [...document.querySelectorAll(${JSON.stringify(selector)})].find((each) => each.textContent.trim() === ${JSON.stringify(text)}); found?.click(); return !!found })()`
    )
    if (!pressed) throw new Error(`Nothing to press: ${selector} "${text}"`)
  }

  const close = async (): Promise<void> => {
    socket.close()
    child.removeAllListeners('exit')
    const gone = new Promise((resolve) => child.once('exit', resolve))
    child.kill()
    await gone
    await rm(userData, { recursive: true, force: true })
  }

  return { page, until, press, close, userData }
}
