import { app, autoUpdater, BrowserWindow, shell } from 'electron'
import { notify } from './notify'

// Each release carries update.json, in Squirrel.Mac's JSON form, made by the release workflow.
// GitHub sends `latest/download` to the newest release, so this address never changes.
const RELEASES = 'https://github.com/avedelphina/mate/releases/latest'
const FEED = `${RELEASES}/download/update.json`
const EVERY = 6 * 60 * 60 * 1000

export type Update = { state: 'idle' | 'checking' | 'none' | 'downloading' | 'ready' | 'out' | 'failed'; version?: string; message?: string }

let now: Update = { state: 'idle' }
let fed = false

function tell(next: Update): Update {
  now = next
  // The reader may not be looking at Mate when a new version is there.
  if (next.state === 'ready' || next.state === 'out') notify('Mate', `${next.version ? `Version ${next.version} is` : 'A new version is'} ${next.state === 'ready' ? 'ready. It is put in when Mate quits.' : 'out.'}`)
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('update', now)
  return now
}

export const updateNow = (): Update => now

/** Asks GitHub for a newer version now, and every six hours. Only the installed app updates itself. */
export function startUpdates(): void {
  if (!app.isPackaged) return
  if (process.platform === 'darwin') {
    autoUpdater.on('checking-for-update', () => tell({ state: 'checking' }))
    autoUpdater.on('update-available', () => tell({ state: 'downloading' }))
    autoUpdater.on('update-not-available', () => tell({ state: 'none' }))
    autoUpdater.on('update-downloaded', (_event, _notes, name) => tell({ state: 'ready', version: name }))
    autoUpdater.on('error', (error) => tell({ state: 'failed', message: error.message }))
    try {
      autoUpdater.setFeedURL({ url: FEED, serverType: 'json' })
      fed = true
    } catch (error) {
      // An app with no signature of a developer, as `pack:mac` makes it, cannot be updated.
      tell({ state: 'failed', message: (error as Error).message })
      return
    }
  }
  void checkForUpdate()
  setInterval(() => void checkForUpdate(), EVERY)
}

/**
 * On a Mac, Squirrel compares and downloads, and says what it did through the events above. On Linux
 * Mate reads the same file, and says a new version is out: an AppImage or a package is put in by the reader.
 */
export async function checkForUpdate(): Promise<Update> {
  if (!app.isPackaged) return tell({ state: 'failed', message: 'Run from a checkout, Mate does not update itself.' })
  if (now.state === 'downloading' || now.state === 'ready') return now
  if (process.platform === 'darwin') {
    if (fed) autoUpdater.checkForUpdates()
    return now
  }
  tell({ state: 'checking' })
  try {
    const response = await fetch(FEED)
    if (!response.ok) throw new Error(`GitHub answered ${response.status}.`)
    const { currentRelease } = (await response.json()) as { currentRelease?: unknown }
    const newer = typeof currentRelease === 'string' && currentRelease.localeCompare(app.getVersion(), undefined, { numeric: true }) > 0
    return tell(newer ? { state: 'out', version: currentRelease } : { state: 'none' })
  } catch (error) {
    return tell({ state: 'failed', message: (error as Error).message })
  }
}

/** On a Mac, restarts into the version that was downloaded. On Linux, opens the page to download it from. */
export function installUpdate(): void {
  if (process.platform === 'darwin') {
    if (now.state === 'ready') autoUpdater.quitAndInstall()
  } else if (now.state === 'out') void shell.openExternal(RELEASES)
}
