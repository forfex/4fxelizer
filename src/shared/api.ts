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
  /** What the main view shows: the 2D viewer, it and the 3D view side by side, or the 3D view. */
  viewMode: ViewMode
  /** Share of the main view the 2D viewer gets in the side-by-side mode (0.15–0.85). */
  viewSplit: number
  /** How the 3D view draws models (the PSX look). */
  view3d: View3dSettings
  /** Map baking: resolution, which maps, and their settings. */
  bake: BakeSettings
}

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

/** Main view modes: the 2D viewer, 2D and 3D side by side, or the 3D view alone. */
export const VIEW_MODES = ['2d', 'split', '3d'] as const
export type ViewMode = (typeof VIEW_MODES)[number]

/** Names shown in the view mode switch and the View menu, in VIEW_MODES order. */
export const VIEW_MODE_NAMES: Record<ViewMode, string> = { '2d': '2D', split: '2D / 3D', '3d': '3D' }

/** Narrowest share of the main view either side gets in the side-by-side mode. */
export const MIN_VIEW_SPLIT = 0.15

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
  viewMode: '2d',
  viewSplit: 0.5,
  view3d: DEFAULT_VIEW3D,
  bake: DEFAULT_BAKE
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

/** Settings from disk with missing or invalid fields replaced by defaults (old files keep working). */
export function normalizeSettings(raw: unknown): UserSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const bool = (key: 'grid' | 'split' | 'tile' | 'psxCheck'): boolean => (typeof r[key] === 'boolean' ? (r[key] as boolean) : DEFAULT_SETTINGS[key])
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
    viewMode: VIEW_MODES.includes(r.viewMode as ViewMode) ? (r.viewMode as ViewMode) : DEFAULT_SETTINGS.viewMode,
    viewSplit:
      typeof r.viewSplit === 'number' && Number.isFinite(r.viewSplit)
        ? Math.min(Math.max(r.viewSplit, MIN_VIEW_SPLIT), 1 - MIN_VIEW_SPLIT)
        : DEFAULT_SETTINGS.viewSplit,
    view3d: normalizeView3d(r.view3d),
    bake: normalizeBake(r.bake)
  }
}

export interface MainGpuInfo {
  platform: string
  arch: string
  versions: { electron: string; chrome: string; node: string }
  commandLineFlags: string[]
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

export type MenuCommand =
  | 'open'
  | 'open-model'
  | 'export'
  | 'import-palette'
  | 'presets'
  | 'import-preset'
  | 'undo'
  | 'redo'
  | 'zoom-fit'
  | 'zoom-actual'
  | 'zoom-in'
  | 'zoom-out'
  | 'toggle-grid'
  | 'toggle-split'
  | 'toggle-tile'
  | `theme-${Theme}`
  | `view-${ViewMode}`
  | 'gpu-diagnostics'

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
  titleBarOverlay: 'window:title-bar-overlay'
} as const

/** Colors (CSS color strings) and height (CSS px) of the native window buttons over the custom title bar. */
export interface TitleBarOverlay {
  color: string
  symbolColor: string
  height: number
}
