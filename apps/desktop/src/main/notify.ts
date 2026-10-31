import { app, BrowserWindow, Notification } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const file = () => path.join(app.getPath('userData'), 'notifications.json')

/** Whether the reader wants to be told. On until they say otherwise. */
export function notifying(): boolean {
  try {
    return (JSON.parse(readFileSync(file(), 'utf8')) as { on?: unknown }).on !== false
  } catch {
    return true
  }
}

export function setNotifying(on: boolean): boolean {
  writeFileSync(file(), JSON.stringify({ on: on === true }), { mode: 0o600 })
  return on === true
}

/**
 * Tell the reader something with the system's own notification, when Mate is not what they are
 * looking at. It says which agent and which project and what is needed, in words of ours: nothing of
 * a document goes into it, since a notification stays in the system's list and on a locked screen.
 */
export function notify(title: string, body: string): void {
  if (!notifying() || !Notification.isSupported()) return
  const windows = BrowserWindow.getAllWindows()
  if (windows.some((window) => window.isFocused())) return
  const shown = new Notification({ title, body, silent: false })
  // A press brings Mate forward.
  shown.on('click', () => {
    const window = windows.find((each) => !each.isDestroyed())
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })
  shown.show()
}
