import { create } from 'zustand'
import type { StageSpec } from '@/gpu/plan'
import type { PosterizeParams } from '@/gpu/passes/posterize'
import { centered, fitView, stepZoom, zoomAt, type Size, type View } from '@/viewer/viewport'

export interface ImageInfo {
  name: string
  width: number
  height: number
  /** Bumped on every load, so effects re-run even for same-named files. */
  version: number
}

export type GpuState =
  | { status: 'loading' }
  | { status: 'ready'; adapter: string }
  | { status: 'error'; message: string }

export interface Message {
  text: string
  kind: 'info' | 'error'
}

interface AppState {
  gpu: GpuState
  image: ImageInfo | null
  stages: StageSpec[]
  view: View
  /** Viewer canvas size in device pixels. */
  canvasSize: Size
  grid: boolean
  split: boolean
  /** Split divider position as a fraction of the canvas width. */
  splitPos: number
  cursor: { x: number; y: number } | null
  message: Message | null
  diagnosticsOpen: boolean

  setGpu(gpu: GpuState): void
  setImage(image: Omit<ImageInfo, 'version'>): void
  updateStage(uid: string, patch: Partial<Omit<StageSpec, 'uid' | 'passId'>>): void
  setView(view: View): void
  setCanvasSize(size: Size): void
  zoomFit(): void
  zoomActual(): void
  zoomStep(dir: 1 | -1): void
  toggleGrid(): void
  toggleSplit(): void
  setSplitPos(pos: number): void
  setCursor(cursor: { x: number; y: number } | null): void
  setMessage(message: Message | null): void
  setDiagnosticsOpen(open: boolean): void
}

const posterizeStage: StageSpec = {
  uid: 'posterize-1',
  passId: 'posterize',
  params: { levels: 6 } satisfies PosterizeParams,
  enabled: true
}

export const useApp = create<AppState>()((set, get) => ({
  gpu: { status: 'loading' },
  image: null,
  stages: [posterizeStage],
  view: { zoom: 1, x: 0, y: 0 },
  canvasSize: { width: 0, height: 0 },
  grid: true,
  split: true,
  splitPos: 0.5,
  cursor: null,
  message: null,
  diagnosticsOpen: false,

  setGpu: (gpu) => set({ gpu }),
  setImage: (image) => {
    const version = (get().image?.version ?? 0) + 1
    set({ image: { ...image, version }, view: fitView(image, get().canvasSize) })
  },
  updateStage: (uid, patch) =>
    set({ stages: get().stages.map((s) => (s.uid === uid ? { ...s, ...patch } : s)) }),
  setView: (view) => set({ view }),
  setCanvasSize: (canvasSize) => {
    const prev = get().canvasSize
    const { view } = get()
    // Keep the image center fixed while the window resizes.
    const shifted = {
      zoom: view.zoom,
      x: Math.round(view.x + (canvasSize.width - prev.width) / 2),
      y: Math.round(view.y + (canvasSize.height - prev.height) / 2)
    }
    const image = get().image
    const firstLayout = prev.width === 0 && image
    set({ canvasSize, view: firstLayout ? fitView(image, canvasSize) : shifted })
  },
  zoomFit: () => {
    const { image, canvasSize } = get()
    if (image) set({ view: fitView(image, canvasSize) })
  },
  zoomActual: () => {
    const { image, canvasSize } = get()
    if (image) set({ view: centered(image, canvasSize, 1) })
  },
  zoomStep: (dir) => {
    const { view, canvasSize } = get()
    const center = { x: canvasSize.width / 2, y: canvasSize.height / 2 }
    set({ view: zoomAt(view, stepZoom(view.zoom, dir), center) })
  },
  toggleGrid: () => set({ grid: !get().grid }),
  toggleSplit: () => set({ split: !get().split }),
  setSplitPos: (splitPos) => set({ splitPos: Math.min(Math.max(splitPos, 0), 1) }),
  setCursor: (cursor) => set({ cursor }),
  setMessage: (message) => set({ message }),
  setDiagnosticsOpen: (diagnosticsOpen) => set({ diagnosticsOpen })
}))
