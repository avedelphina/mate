// Draws the application icons from build/icon.svg with Electron.
// Run it with Electron, not with Node: `pnpm icon`. Run it again when the drawing changes.
import { app, BrowserWindow } from 'electron'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const here = import.meta.dirname
const set = path.join(here, 'icon.iconset')
app.dock?.hide()
setTimeout(() => (console.error('The drawing did not come.'), app.exit(1)), 20_000).unref()

// Not awaited here: Electron is not ready until this file has been read to its end.
app.whenReady().then(async () => {
  // Drawn off the screen: no window opens, and each frame arrives as a picture that keeps what is see-through.
  const window = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } })
  let frame
  window.webContents.on('paint', (_event, _dirty, image) => (frame = image))
  const drawing = readFileSync(path.join(here, 'icon.svg'), 'utf8')
  await window.loadURL(`data:text/html,${encodeURIComponent(`<body style="margin:0;background:transparent">${drawing}`)}`)
  while (!frame) await new Promise((resolve) => setTimeout(resolve, 100))
  await new Promise((resolve) => setTimeout(resolve, 400))
  const full = frame.resize({ width: 1024, height: 1024, quality: 'best' })

  rmSync(set, { recursive: true, force: true })
  mkdirSync(set)
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`
      writeFileSync(path.join(set, name), full.resize({ width: size * scale, height: size * scale, quality: 'best' }).toPNG())
    }
  }
  writeFileSync(path.join(here, 'icon.png'), full.toPNG())
  if (process.platform === 'darwin') execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(here, 'icon.icns')])
  rmSync(set, { recursive: true, force: true })
  app.quit()
})
