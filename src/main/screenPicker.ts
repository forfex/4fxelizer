// Screen color picker: captures every display, covers each with an always-on-top overlay window
// showing its capture (src/renderer/picker.html), and returns the colors clicked there. Works over
// other applications and on every monitor, with no native code: the capture is desktopCapturer's.

import { join } from 'node:path'
import { BrowserWindow, desktopCapturer, ipcMain, screen, systemPreferences, type Display } from 'electron'
import { isHexColor, matchSources, physicalSize, PICKER_IPC, type ScreenCapture, type ScreenPickResult } from '@shared/screenPick'

interface Session {
  owner: BrowserWindow
  overlays: BrowserWindow[]
  colors: string[]
  waiting: number
  finish(): void
}

let session: Session | null = null
/** The display each overlay covers. */
const overlayDisplay = new WeakMap<BrowserWindow, Display>()
let running: Promise<ScreenPickResult> | null = null

/** Runs one pick from `owner` (a second request while one is open waits for the same result). */
export function pickScreenColors(owner: BrowserWindow, theme: string): Promise<ScreenPickResult> {
  running ??= run(owner, theme).finally(() => {
    running = null
  })
  return running
}

/** The overlays' IPC; call once at startup. */
export function registerScreenPicker(): void {
  const from = (sender: Electron.WebContents): Session | null =>
    session && session.overlays.some((w) => !w.isDestroyed() && w.webContents === sender) ? session : null

  ipcMain.on(PICKER_IPC.ready, (event) => {
    const s = from(event.sender)
    if (s && --s.waiting === 0) showOverlays(s)
  })
  ipcMain.on(PICKER_IPC.pick, (event, hex: unknown, more: unknown) => {
    const s = from(event.sender)
    if (!s || !isHexColor(hex)) return
    s.colors.push(hex)
    if (more !== true) return s.finish()
    for (const w of s.overlays) if (!w.isDestroyed()) w.webContents.send(PICKER_IPC.picked, s.colors.length)
  })
  ipcMain.on(PICKER_IPC.done, (event) => from(event.sender)?.finish())
}

async function run(owner: BrowserWindow, theme: string): Promise<ScreenPickResult> {
  const displays = screen.getAllDisplays()
  let captures: (Omit<ScreenCapture, 'picked'> | null)[]
  try {
    captures = await captureDisplays(displays)
  } catch (e) {
    return { error: `Couldn't capture the screen (${e instanceof Error ? e.message : String(e)}).` }
  }
  if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
    return { error: 'Allow 4FXELIZER to record the screen (System Settings › Privacy & Security › Screen Recording), then try again.' }
  }
  if (!captures.some(Boolean)) return { error: "Couldn't capture the screen." }

  return new Promise<ScreenPickResult>((resolve) => {
    const s: Session = {
      owner,
      overlays: [],
      colors: [],
      waiting: 0,
      finish: () => {
        if (session !== s) return
        session = null
        for (const w of s.overlays) if (!w.isDestroyed()) w.destroy()
        if (!owner.isDestroyed()) owner.focus()
        resolve({ colors: s.colors })
      }
    }
    session = s
    displays.forEach((display, i) => {
      const capture = captures[i]
      if (!capture) return
      s.waiting++
      s.overlays.push(openOverlay(display, capture, theme, s))
    })
    owner.once('closed', s.finish)
  })
}

/**
 * Captures each display at its full device-pixel size, so picked colors are exact. desktopCapturer
 * scales every source to one thumbnail size, so displays of different sizes are captured separately.
 */
async function captureDisplays(displays: Display[]): Promise<(Omit<ScreenCapture, 'picked'> | null)[]> {
  const result: (Omit<ScreenCapture, 'picked'> | null)[] = displays.map(() => null)
  const sizes = new Map<string, number[]>()
  displays.forEach((d, i) => {
    const { width, height } = physicalSize(d)
    const key = `${width}x${height}`
    sizes.set(key, [...(sizes.get(key) ?? []), i])
  })
  for (const [key, indices] of sizes) {
    const [width, height] = key.split('x').map(Number) as [number, number]
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } })
    const match = matchSources(displays.map((d) => String(d.id)), sources.map((s) => s.display_id))
    for (const i of indices) {
      const thumbnail = match[i]! >= 0 ? sources[match[i]!]!.thumbnail : null
      if (!thumbnail || thumbnail.isEmpty()) continue
      const size = thumbnail.getSize()
      result[i] = { width: size.width, height: size.height, bgra: new Uint8Array(thumbnail.toBitmap()) }
    }
  }
  return result
}

function openOverlay(display: Display, capture: Omit<ScreenCapture, 'picked'>, theme: string, s: Session): BrowserWindow {
  const win = new BrowserWindow({
    ...display.bounds,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    enableLargerThanScreen: true,
    alwaysOnTop: true,
    backgroundColor: '#000000',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/picker.cjs'),
      sandbox: true,
      contextIsolation: true
    }
  })
  // Above everything, the taskbar and the macOS menu bar included.
  overlayDisplay.set(win, display)
  win.setAlwaysOnTop(true, 'screen-saver')
  if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.once('did-finish-load', () => win.webContents.send(PICKER_IPC.capture, { ...capture, picked: s.colors.length }))
  // Closed some other way (Alt+F4): the pick ends.
  win.once('closed', () => s.finish())
  const query = { theme }
  if (!process.env.ELECTRON_RENDERER_URL) {
    win.loadFile(join(import.meta.dirname, '../renderer/picker.html'), { query })
  } else {
    const url = new URL('picker.html', process.env.ELECTRON_RENDERER_URL)
    url.search = new URLSearchParams(query).toString()
    win.loadURL(url.toString())
  }
  return win
}

/** Shows every overlay once all have drawn their capture, focusing the one under the pointer (for Esc). */
function showOverlays(s: Session): void {
  const cursor = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  let focus: BrowserWindow | undefined
  for (const w of s.overlays) {
    if (w.isDestroyed()) continue
    // Again after creation: Windows can size a window for the wrong DPI when it spans monitors.
    const display = overlayDisplay.get(w)!
    w.setBounds(display.bounds)
    w.show()
    if (display.id === cursor.id) focus = w
  }
  ;(focus ?? s.overlays.find((w) => !w.isDestroyed()))?.focus()
}
