// Contract between the preload bridge (window.fx) and the renderer.

export interface FileFilter {
  name: string
  extensions: string[]
}

export interface OpenedFile {
  name: string
  bytes: Uint8Array
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
  /** Last format chosen in the Export dialog. */
  exportFormat: ExportFormat
  /** Panel layout as last arranged (dockview JSON); null = build the active workspace fresh. */
  layout: object | null
  /** Active workspace: a built-in workspace id, or the name of a saved one. */
  workspace: string
  /** Workspaces the user saved (Workspace › Save workspace as…). */
  workspaces: SavedWorkspace[]
}

export interface SavedWorkspace {
  name: string
  /** dockview JSON. */
  layout: object
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
  exportFormat: 'png-indexed',
  layout: null,
  workspace: 'essentials',
  workspaces: []
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
  const bool = (key: 'grid' | 'split'): boolean => (typeof r[key] === 'boolean' ? (r[key] as boolean) : DEFAULT_SETTINGS[key])
  return {
    grid: bool('grid'),
    split: bool('split'),
    exportFormat: EXPORT_FORMATS.includes(r.exportFormat as string) ? (r.exportFormat as ExportFormat) : DEFAULT_SETTINGS.exportFormat,
    layout: isObject(r.layout) ? r.layout : null,
    workspace: typeof r.workspace === 'string' && r.workspace.trim() ? r.workspace : DEFAULT_SETTINGS.workspace,
    workspaces: normalizeWorkspaces(r.workspaces)
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
  | 'gpu-diagnostics'

export interface FxApi {
  platform: string
  /** Saved settings, read once when the window loads. */
  settings: UserSettings
  /** Stores changed settings (written to disk shortly after). */
  saveSettings(patch: Partial<UserSettings>): void
  openImage(): Promise<OpenedFile | null>
  openFile(filters: FileFilter[]): Promise<OpenedFile | null>
  saveFile(defaultName: string, bytes: Uint8Array, filters: FileFilter[]): Promise<string | null>
  /** Presets folder in the app's user-data directory (created on demand). */
  listPresets(): Promise<PresetEntry[]>
  readPreset(file: string): Promise<string>
  writePreset(file: string, json: string): Promise<void>
  deletePreset(file: string): Promise<void>
  showPresetsFolder(): Promise<void>
  getGpuInfo(): Promise<MainGpuInfo>
  submitGpuReport(report: RendererGpuReport): void
  onMenuCommand(listener: (command: MenuCommand) => void): () => void
}

export const IPC = {
  openImage: 'image:open',
  openFile: 'file:open',
  saveFile: 'file:save',
  presetsList: 'presets:list',
  presetsRead: 'presets:read',
  presetsWrite: 'presets:write',
  presetsDelete: 'presets:delete',
  presetsShow: 'presets:show',
  gpuInfo: 'gpu:info',
  gpuReport: 'gpu:report',
  menuCommand: 'menu:command',
  settingsLoad: 'settings:load',
  settingsSave: 'settings:save'
} as const
