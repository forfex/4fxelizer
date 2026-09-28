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
  exportFormat: 'png-indexed' | 'png-rgba'
}

export const DEFAULT_SETTINGS: UserSettings = {
  grid: false,
  split: true,
  exportFormat: 'png-indexed'
}

/** Settings from disk with missing or invalid fields replaced by defaults (old files keep working). */
export function normalizeSettings(raw: unknown): UserSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const bool = (key: 'grid' | 'split'): boolean => (typeof r[key] === 'boolean' ? (r[key] as boolean) : DEFAULT_SETTINGS[key])
  return {
    grid: bool('grid'),
    split: bool('split'),
    exportFormat: r.exportFormat === 'png-rgba' || r.exportFormat === 'png-indexed' ? r.exportFormat : DEFAULT_SETTINGS.exportFormat
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
