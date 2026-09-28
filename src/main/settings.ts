// User settings and window placement, kept in <userData>/settings.json (per-user app data on
// every OS). Read once at startup; writes are debounced and atomic (temp file + rename).

import { app, screen, type BrowserWindow, type Rectangle } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { normalizeSettings, type UserSettings } from '@shared/api'

interface WindowState {
  bounds?: Rectangle
  maximized?: boolean
}

interface SettingsFile {
  version: 1
  ui: UserSettings
  window: WindowState
}

const SAVE_DELAY_MS = 300

const file = (): string => join(app.getPath('userData'), 'settings.json')

let state: SettingsFile | null = null
let timer: NodeJS.Timeout | undefined

function load(): SettingsFile {
  if (state) return state
  let raw: Partial<SettingsFile> = {}
  try {
    raw = JSON.parse(readFileSync(file(), 'utf8')) as Partial<SettingsFile>
  } catch {
    // Missing or unreadable: start from defaults.
  }
  state = { version: 1, ui: normalizeSettings(raw.ui), window: validWindow(raw.window) }
  return state
}

function validWindow(raw: unknown): WindowState {
  if (typeof raw !== 'object' || raw === null) return {}
  const w = raw as WindowState
  const b = w.bounds
  const ok = b && [b.x, b.y, b.width, b.height].every((v) => Number.isFinite(v))
  return { bounds: ok ? b : undefined, maximized: w.maximized === true }
}

function writeNow(): void {
  if (!state) return
  const path = file()
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(`${path}.tmp`, JSON.stringify(state, null, 2))
    renameSync(`${path}.tmp`, path)
  } catch (e) {
    console.error('Could not save settings:', e)
  }
}

function saveSoon(): void {
  clearTimeout(timer)
  timer = setTimeout(writeNow, SAVE_DELAY_MS)
}

/** Writes a pending change now (on quit: the renderer's last changes arrive after the window's close event). */
export function flushSettings(): void {
  if (timer === undefined) return
  clearTimeout(timer)
  timer = undefined
  writeNow()
}

export function getSettings(): UserSettings {
  return load().ui
}

export function updateSettings(patch: unknown): void {
  const current = load()
  current.ui = normalizeSettings({ ...current.ui, ...(typeof patch === 'object' && patch !== null ? patch : {}) })
  saveSoon()
}

/**
 * Saved window bounds, if they still fit on a connected display (a monitor may have been
 * unplugged since), sized at least `min`.
 */
export function savedWindowBounds(min: { width: number; height: number }): { bounds?: Partial<Rectangle>; maximized: boolean } {
  const { bounds, maximized = false } = load().window
  if (!bounds) return { maximized }
  const width = Math.max(bounds.width, min.width)
  const height = Math.max(bounds.height, min.height)
  const area = screen.getDisplayMatching(bounds).workArea
  const visible =
    bounds.x < area.x + area.width - 50 &&
    bounds.x + width > area.x + 50 &&
    bounds.y >= area.y - 10 &&
    bounds.y < area.y + area.height - 50
  // Off-screen: keep the size, let the OS center the window.
  return { bounds: visible ? { ...bounds, width, height } : { width, height }, maximized }
}

/** Remembers the window's size, position and maximized state whenever it changes or closes. */
export function trackWindow(win: BrowserWindow): void {
  const remember = (): void => {
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return
    load().window = { bounds: win.getNormalBounds(), maximized: win.isMaximized() }
    saveSoon()
  }
  win.on('resize', remember)
  win.on('move', remember)
  win.on('maximize', remember)
  win.on('unmaximize', remember)
  win.on('close', () => {
    remember()
    clearTimeout(timer)
    writeNow()
  })
}
