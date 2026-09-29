// Contract between the preload bridge (window.fx) and the renderer.

import { normalizeBake, normalizeView3d, DEFAULT_BAKE, DEFAULT_VIEW3D, type BakeSettings, type View3dSettings } from './bake'
import type { MenuRole } from './menu'

export interface FileFilter {
  name: string
  extensions: string[]
}

export interface OpenedFile {
  name: string
  bytes: Uint8Array
  /** Full path on disk, when known (used to find a texture's map files next to it). */
  path?: string
}

/** A preset saved in the user's presets folder. */
export interface PresetEntry {
  /** Display name (from the file's "name" field). */
  name: string
  /** File name inside the presets folder, e.g. "PSX look.4fxpreset". */
  file: string
}

/** Preferences remembered between sessions (stored in <userData>/settings.json). */
export interface UserSettings {
  /** Pixel grid in the viewer. */
  grid: boolean
  /** Before/after split view. */
  split: boolean
  /** Tiling view (copies of the texture around it). */
  tile: boolean
  /** Interface theme. */
  theme: Theme
  /** Last format chosen in the Export dialog. */
  exportFormat: ExportFormat
  /** Export dialog lists how the result fits PSX texture limits. */
  psxCheck: boolean
  /** Panel layout as last arranged (dockview JSON); null = build the active workspace fresh. */
  layout: object | null
  /** Active workspace: a built-in workspace id, or the name of a saved one. */
  workspace: string
  /** Workspaces the user saved (Workspace › Save workspace as…). */
  workspaces: SavedWorkspace[]
  /** How the 3D view draws models (the PSX look). */
  view3d: View3dSettings
  /** Map baking: resolution, which maps, and their settings. */
  bake: BakeSettings
  /** How the mouse wheel reaches sliders and dropdowns. */
  wheel: WheelSettings
  /** Keyboard shortcuts changed from the defaults: an accelerator per command, '' = none. */
  keybinds: Keybinds
  /** Which GPU WebGPU asks for (applied at the next start). */
  gpu: GpuPreference
  /** Interface zoom (1 = 100%). */
  uiScale: number
  /** Wheel up zooms out in the viewer and the 3D view. */
  invertZoom: boolean
}

/**
 * Mouse wheel over sliders and dropdowns. `hover`: it changes the value once the pointer has
 * rested on the control for `delay` ms (or it was pressed), and scrolls the panel until then;
 * `click`: only after the control was pressed; `always`: right away; `off`: never.
 */
export const WHEEL_MODES = ['hover', 'click', 'always', 'off'] as const
export type WheelMode = (typeof WHEEL_MODES)[number]
export interface WheelSettings {
  mode: WheelMode
  /** Rest time before the wheel arms in `hover` mode (ms). */
  delay: number
}
export const WHEEL_DELAY = { min: 100, max: 3000 } as const

export type Keybinds = Partial<Record<MenuCommand, string>>

/**
 * `auto` asks WebGPU for its high-performance adapter; the other two also tell Chromium which GPU
 * to run on where a machine has two (laptops with integrated + discrete graphics).
 */
export const GPU_PREFERENCES = ['auto', 'high-performance', 'low-power'] as const
export type GpuPreference = (typeof GPU_PREFERENCES)[number]

export const UI_SCALES = [0.8, 0.9, 1, 1.1, 1.25, 1.5] as const

export interface SavedWorkspace {
  name: string
  /** dockview JSON. */
  layout: object
}

/**
 * Interface themes (`data-theme` on <html>, values in styles/tokens.css). Dark is the plum desktop
 * with purple and magenta accents; Night is neutral greyscale for dim rooms and color judging;
 * Light is its daylight counterpart; Matrix is green phosphor on black; Retro is the classic
 * silver-grey desktop with navy title bars and square corners.
 */
export const THEMES = ['dark', 'night', 'light', 'matrix', 'retro'] as const
export type Theme = (typeof THEMES)[number]

/** Names shown in the theme pickers (menu and toolbar), in THEMES order. */
export const THEME_NAMES: Record<Theme, string> = { dark: 'Dark', night: 'Night', light: 'Light', matrix: 'Matrix', retro: 'Retro' }

/** One-line descriptions shown with the theme names (toolbar dropdown, Settings). */
export const THEME_HINTS: Record<Theme, string> = {
  dark: 'Plum with purple and magenta accents',
  night: 'Neutral greyscale, for dim rooms and judging colors',
  light: 'Daylight: pale lilac surfaces, dark text',
  matrix: 'Green phosphor on black',
  retro: 'Classic silver-grey desktop, navy title bars, square corners'
}

/**
 * Title-bar ground (also the window background before the renderer has loaded its tokens) and the
 * window-button symbol color per theme. Keep in sync with --fx-titlebar-bg / --fx-titlebar-symbol
 * in styles/tokens.css.
 */
export const THEME_WINDOW_COLORS: Record<Theme, { background: string; symbol: string }> = {
  dark: { background: '#16121e', symbol: '#f1e9dc' },
  night: { background: '#090909', symbol: '#e3e3e3' },
  light: { background: '#e6e0ee', symbol: '#1e1829' },
  matrix: { background: '#010603', symbol: '#9dffb0' },
  retro: { background: '#000080', symbol: '#ffffff' }
}

/** Most saved workspaces kept (oldest dropped first). */
export const MAX_WORKSPACES = 32

export const EXPORT_FILE_TYPES = ['png', 'tga', 'bmp'] as const
export type ExportFileType = (typeof EXPORT_FILE_TYPES)[number]
/** File type plus color mode: palette-indexed, or full RGBA. */
export type ExportFormat = `${ExportFileType}-${'indexed' | 'rgba'}`

const EXPORT_FORMATS: readonly string[] = EXPORT_FILE_TYPES.flatMap((t) => [`${t}-indexed`, `${t}-rgba`])

export const DEFAULT_SETTINGS: UserSettings = {
  grid: false,
  split: true,
  tile: false,
  theme: 'dark',
  exportFormat: 'png-indexed',
  psxCheck: false,
  layout: null,
  workspace: 'essentials',
  workspaces: [],
  view3d: DEFAULT_VIEW3D,
  bake: DEFAULT_BAKE,
  wheel: { mode: 'hover', delay: 1000 },
  keybinds: {},
  gpu: 'auto',
  uiScale: 1,
  invertZoom: false
}

const isObject = (v: unknown): v is object => typeof v === 'object' && v !== null && !Array.isArray(v)

function normalizeWorkspaces(raw: unknown): SavedWorkspace[] {
  if (!Array.isArray(raw)) return []
  const byName = new Map<string, SavedWorkspace>()
  for (const w of raw) {
    if (!isObject(w)) continue
    const { name, layout } = w as Record<string, unknown>
    if (typeof name !== 'string' || !name.trim() || !isObject(layout)) continue
    byName.delete(name.trim()) // a later entry with the same name wins
    byName.set(name.trim(), { name: name.trim(), layout })
  }
  return [...byName.values()].slice(-MAX_WORKSPACES)
}

function normalizeWheel(raw: unknown): WheelSettings {
  const r = (isObject(raw) ? raw : {}) as Record<string, unknown>
  const delay = typeof r.delay === 'number' && Number.isFinite(r.delay) ? Math.round(r.delay) : DEFAULT_SETTINGS.wheel.delay
  return {
    mode: WHEEL_MODES.includes(r.mode as WheelMode) ? (r.mode as WheelMode) : DEFAULT_SETTINGS.wheel.mode,
    delay: Math.min(Math.max(delay, WHEEL_DELAY.min), WHEEL_DELAY.max)
  }
}

/** Accelerator strings as Electron writes them ("CmdOrCtrl+Shift+P", "F5", "Alt+num1"). */
const ACCELERATOR = /^[A-Za-z0-9+=\-[\];',./\\`]{1,64}$/

function normalizeKeybinds(raw: unknown): Keybinds {
  if (!isObject(raw)) return {}
  const out: Keybinds = {}
  for (const [command, accelerator] of Object.entries(raw)) {
    if (!MENU_COMMANDS.includes(command as MenuCommand) || typeof accelerator !== 'string') continue
    if (accelerator === '' || ACCELERATOR.test(accelerator)) out[command as MenuCommand] = accelerator
  }
  return out
}

function normalizeScale(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_SETTINGS.uiScale
  // The nearest offered step.
  return UI_SCALES.reduce((best, s) => (Math.abs(s - raw) < Math.abs(best - raw) ? s : best), DEFAULT_SETTINGS.uiScale)
}

/** Settings from disk with missing or invalid fields replaced by defaults (old files keep working). */
export function normalizeSettings(raw: unknown): UserSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const bool = (key: 'grid' | 'split' | 'tile' | 'psxCheck' | 'invertZoom'): boolean => (typeof r[key] === 'boolean' ? (r[key] as boolean) : DEFAULT_SETTINGS[key])
  return {
    grid: bool('grid'),
    split: bool('split'),
    tile: bool('tile'),
    theme: THEMES.includes(r.theme as Theme) ? (r.theme as Theme) : DEFAULT_SETTINGS.theme,
    exportFormat: EXPORT_FORMATS.includes(r.exportFormat as string) ? (r.exportFormat as ExportFormat) : DEFAULT_SETTINGS.exportFormat,
    psxCheck: bool('psxCheck'),
    layout: isObject(r.layout) ? r.layout : null,
    workspace: typeof r.workspace === 'string' && r.workspace.trim() ? r.workspace.trim() : DEFAULT_SETTINGS.workspace,
    workspaces: normalizeWorkspaces(r.workspaces),
    view3d: normalizeView3d(r.view3d),
    bake: normalizeBake(r.bake),
    wheel: normalizeWheel(r.wheel),
    keybinds: normalizeKeybinds(r.keybinds),
    gpu: GPU_PREFERENCES.includes(r.gpu as GpuPreference) ? (r.gpu as GpuPreference) : DEFAULT_SETTINGS.gpu,
    uiScale: normalizeScale(r.uiScale),
    invertZoom: bool('invertZoom')
  }
}

export interface MainGpuInfo {
  platform: string
  arch: string
  versions: { electron: string; chrome: string; node: string }
  commandLineFlags: string[]
  /** The GPU preference this run started with (a changed one applies after a restart). */
  gpuPreference: GpuPreference
  featureStatus: Record<string, string>
  gpuInfo: unknown
}

export interface RendererGpuReport {
  webgpu: boolean
  error?: string
  adapter?: { vendor: string; architecture: string; device: string; description: string }
  features?: string[]
  limits?: Record<string, number>
  preferredCanvasFormat?: string
  /** Runs a real compute pass + readback and compares against a CPU result. */
  smokeTest?: { ok: boolean; detail: string }
}

const PLAIN_COMMANDS = [
  'open',
  'open-model',
  'export',
  'import-palette',
  'presets',
  'import-preset',
  'undo',
  'redo',
  'settings',
  'zoom-fit',
  'zoom-actual',
  'zoom-in',
  'zoom-out',
  'toggle-grid',
  'toggle-split',
  'toggle-tile',
  'gpu-diagnostics'
] as const

export type MenuCommand = (typeof PLAIN_COMMANDS)[number] | `theme-${Theme}`

/** Every menu command (keybinds are checked against it). */
export const MENU_COMMANDS: readonly MenuCommand[] = [...PLAIN_COMMANDS, ...THEMES.map((t) => `theme-${t}` as const)]

export interface FxApi {
  platform: string
  /** Saved settings, read once when the window loads. */
  settings: UserSettings
  /** Stores changed settings (written to disk shortly after). */
  saveSettings(patch: Partial<UserSettings>): void
  openImage(): Promise<OpenedFile | null>
  /** Asks for a 3D model file (glTF, GLB, FBX, OBJ). */
  openModel(): Promise<OpenedFile | null>
  /**
   * A file a model refers to (glTF buffer, OBJ material library, texture), looked up relative to
   * the model's folder and then by name (see referenceCandidates in @shared/model); null = not found.
   */
  readModelFile(modelPath: string, reference: string): Promise<OpenedFile | null>
  openFile(filters: FileFilter[]): Promise<OpenedFile | null>
  saveFile(defaultName: string, bytes: Uint8Array, filters: FileFilter[]): Promise<string | null>
  /** Map files (AO, cavity, …) next to a texture, recognized by name (see @shared/maps). */
  findMaps(texturePath: string): Promise<OpenedFile[]>
  /** Path on disk of a dropped file ('' when it has none). */
  pathForFile(file: File): string
  /** Presets folder in the app's user-data directory (created on demand). */
  listPresets(): Promise<PresetEntry[]>
  readPreset(file: string): Promise<string>
  writePreset(file: string, json: string): Promise<void>
  deletePreset(file: string): Promise<void>
  showPresetsFolder(): Promise<void>
  getGpuInfo(): Promise<MainGpuInfo>
  submitGpuReport(report: RendererGpuReport): void
  onMenuCommand(listener: (command: MenuCommand) => void): () => void
  /** Clipboard/window actions of the in-app menu bar, performed by main. */
  runMenuRole(role: MenuRole): void
  /** Restyles the native window buttons drawn over the custom title bar (Windows/Linux). */
  setTitleBarOverlay(overlay: TitleBarOverlay): void
  /** Zooms the whole interface (1 = 100%). */
  setUiScale(scale: number): void
  /** Restarts the app (settings that apply at startup, such as the GPU). */
  relaunch(): void
  /** Opens the folder holding settings.json and the presets. */
  showUserDataFolder(): Promise<void>
  /** Turns the menu's keyboard shortcuts off (true) while Settings records a new one, and back on. */
  suspendShortcuts(suspend: boolean): void
}

export const IPC = {
  openImage: 'image:open',
  openModel: 'model:open',
  readModelFile: 'model:read-file',
  openFile: 'file:open',
  saveFile: 'file:save',
  findMaps: 'maps:find',
  presetsList: 'presets:list',
  presetsRead: 'presets:read',
  presetsWrite: 'presets:write',
  presetsDelete: 'presets:delete',
  presetsShow: 'presets:show',
  gpuInfo: 'gpu:info',
  gpuReport: 'gpu:report',
  menuCommand: 'menu:command',
  settingsLoad: 'settings:load',
  settingsSave: 'settings:save',
  menuRole: 'menu:role',
  titleBarOverlay: 'window:title-bar-overlay',
  relaunch: 'app:relaunch',
  userDataShow: 'app:show-user-data',
  suspendShortcuts: 'menu:suspend-shortcuts'
} as const

/** Colors (CSS color strings) and height (CSS px) of the native window buttons over the custom title bar. */
export interface TitleBarOverlay {
  color: string
  symbolColor: string
  height: number
}
