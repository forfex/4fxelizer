// Contract between the preload bridge (window.fx) and the renderer.

export interface OpenedFile {
  name: string
  bytes: Uint8Array
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
  | 'zoom-fit'
  | 'zoom-actual'
  | 'zoom-in'
  | 'zoom-out'
  | 'toggle-grid'
  | 'toggle-split'
  | 'gpu-diagnostics'

export interface FxApi {
  platform: string
  openImage(): Promise<OpenedFile | null>
  saveImage(defaultName: string, bytes: Uint8Array): Promise<string | null>
  getGpuInfo(): Promise<MainGpuInfo>
  submitGpuReport(report: RendererGpuReport): void
  onMenuCommand(listener: (command: MenuCommand) => void): () => void
}

export const IPC = {
  openImage: 'image:open',
  saveImage: 'image:save',
  gpuInfo: 'gpu:info',
  gpuReport: 'gpu:report',
  menuCommand: 'menu:command'
} as const
