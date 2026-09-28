import { create } from 'zustand'
import { DEFAULT_BLEND } from '@/gpu/pass'
import { STAGE_TYPES } from '@/gpu/passes'
import type { StageSpec } from '@/gpu/plan'
import { DEFAULT_GENERATOR, type Palette } from '@/palette/palette'
import type { OutputLock } from '@/stack/analyze'
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

/** The undoable part of the state: what a recipe/project file will contain. */
export interface Doc {
  stages: StageSpec[]
  palettes: Palette[]
  outputLock: OutputLock
}

export type PaletteJob = { status: 'running' } | { status: 'error'; message: string } | { status: 'blocked'; message: string }

/** Edits with the same key within this window merge into one undo step (e.g. a slider drag). */
const COALESCE_MS = 1000
const HISTORY_LIMIT = 200

interface AppState extends Doc {
  gpu: GpuState
  image: ImageInfo | null
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
  exportOpen: boolean
  /** Stage whose output the viewer shows (null = final output). */
  previewUid: string | null
  selectedPaletteId: string | null
  /** Auto/manual palette generation status by palette id (absent = idle). */
  paletteJobs: Record<string, PaletteJob>

  past: Doc[]
  future: Doc[]
  lastEdit: { key: string; at: number } | null

  setGpu(gpu: GpuState): void
  setImage(image: Omit<ImageInfo, 'version'>): void
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
  setExportOpen(open: boolean): void
  setPreview(uid: string | null): void
  selectPalette(id: string | null): void
  setPaletteJob(id: string, job: PaletteJob | null): void

  /**
   * Applies an undoable change. `coalesce` merges rapid edits with the same key into one step;
   * `silent` changes state without an undo step (derived updates such as auto-generated colors).
   */
  edit(change: (doc: Doc) => Partial<Doc>, opts?: { coalesce?: string; silent?: boolean }): void
  undo(): void
  redo(): void

  addStage(passId: string, index?: number): void
  duplicateStage(uid: string): void
  removeStage(uid: string): void
  moveStage(uid: string, toIndex: number): void
  updateStage(uid: string, patch: Partial<Omit<StageSpec, 'uid' | 'passId'>>, coalesce?: string): void
  updateParams<P>(uid: string, patch: Partial<P>): void

  addPalette(palette: Omit<Palette, 'id'>): string
  updatePalette(id: string, patch: Partial<Omit<Palette, 'id'>>, opts?: { coalesce?: string; silent?: boolean }): void
  removePalette(id: string): void
}

export const newId = (prefix: string): string => `${prefix}-${crypto.randomUUID().slice(0, 8)}`

function defaultParams(passId: string, paletteId: string | null): unknown {
  const type = STAGE_TYPES.find((t) => t.passId === passId)
  if (!type) throw new Error(`Unknown stage type "${passId}"`)
  const params = structuredClone(type.defaults) as unknown as Record<string, unknown>
  if ('paletteId' in params) params.paletteId = paletteId
  return params
}

function makeStage(passId: string, paletteId: string | null, patch: Record<string, unknown> = {}): StageSpec {
  return {
    uid: newId(passId),
    passId,
    params: { ...(defaultParams(passId, paletteId) as object), ...patch },
    enabled: true,
    blend: { ...DEFAULT_BLEND }
  }
}

function initialDoc(): Doc {
  const palette: Palette = { id: newId('pal'), name: 'Generated', colors: [], generator: { ...DEFAULT_GENERATOR } }
  return {
    stages: [makeStage('adjust', null), makeStage('downscale', null), makeStage('dither', palette.id)],
    palettes: [palette],
    outputLock: { enabled: false, paletteId: palette.id }
  }
}

const snapshot = (s: Doc): Doc => ({ stages: s.stages, palettes: s.palettes, outputLock: s.outputLock })

const doc0 = initialDoc()

export const useApp = create<AppState>()((set, get) => ({
  ...doc0,
  gpu: { status: 'loading' },
  image: null,
  view: { zoom: 1, x: 0, y: 0 },
  canvasSize: { width: 0, height: 0 },
  grid: true,
  split: true,
  splitPos: 0.5,
  cursor: null,
  message: null,
  diagnosticsOpen: false,
  exportOpen: false,
  previewUid: null,
  selectedPaletteId: doc0.palettes[0]!.id,
  paletteJobs: {},
  past: [],
  future: [],
  lastEdit: null,

  setGpu: (gpu) => set({ gpu }),
  setImage: (image) => {
    const version = (get().image?.version ?? 0) + 1
    set({ image: { ...image, version }, view: fitView(image, get().canvasSize) })
  },
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
  setDiagnosticsOpen: (diagnosticsOpen) => set({ diagnosticsOpen }),
  setExportOpen: (exportOpen) => set({ exportOpen }),
  setPreview: (previewUid) => set({ previewUid }),
  selectPalette: (selectedPaletteId) => set({ selectedPaletteId }),
  setPaletteJob: (id, job) => {
    const jobs = { ...get().paletteJobs }
    if (job) jobs[id] = job
    else delete jobs[id]
    set({ paletteJobs: jobs })
  },

  edit: (change, opts = {}) => {
    const s = get()
    const patch = change(snapshot(s))
    if (opts.silent) {
      set(patch)
      return
    }
    const now = performance.now()
    const merge = opts.coalesce && s.lastEdit?.key === opts.coalesce && now - s.lastEdit.at < COALESCE_MS
    set({
      ...patch,
      past: merge ? s.past : [...s.past, snapshot(s)].slice(-HISTORY_LIMIT),
      future: [],
      lastEdit: opts.coalesce ? { key: opts.coalesce, at: now } : null
    })
  },
  undo: () => {
    const s = get()
    const prev = s.past[s.past.length - 1]
    if (!prev) return
    set({ ...prev, past: s.past.slice(0, -1), future: [snapshot(s), ...s.future], lastEdit: null })
  },
  redo: () => {
    const s = get()
    const next = s.future[0]
    if (!next) return
    set({ ...next, past: [...s.past, snapshot(s)], future: s.future.slice(1), lastEdit: null })
  },

  addStage: (passId, index) => {
    const s = get()
    const paletteId = s.selectedPaletteId ?? s.palettes[0]?.id ?? null
    const stage = makeStage(passId, paletteId)
    s.edit((d) => {
      const stages = [...d.stages]
      stages.splice(index ?? stages.length, 0, stage)
      return { stages }
    })
  },
  duplicateStage: (uid) =>
    get().edit((d) => {
      const i = d.stages.findIndex((st) => st.uid === uid)
      if (i < 0) return {}
      const copy = { ...structuredClone(d.stages[i]!), uid: newId(d.stages[i]!.passId) }
      const stages = [...d.stages]
      stages.splice(i + 1, 0, copy)
      return { stages }
    }),
  removeStage: (uid) => {
    if (get().previewUid === uid) set({ previewUid: null })
    get().edit((d) => ({ stages: d.stages.filter((st) => st.uid !== uid) }))
  },
  moveStage: (uid, toIndex) =>
    get().edit((d) => {
      const from = d.stages.findIndex((st) => st.uid === uid)
      if (from < 0) return {}
      const stages = [...d.stages]
      const [stage] = stages.splice(from, 1)
      stages.splice(Math.min(Math.max(toIndex, 0), stages.length), 0, stage!)
      return { stages }
    }),
  updateStage: (uid, patch, coalesce) =>
    get().edit(
      (d) => ({ stages: d.stages.map((st) => (st.uid === uid ? { ...st, ...patch } : st)) }),
      { coalesce: coalesce ?? `stage:${uid}:${Object.keys(patch).join(',')}` }
    ),
  updateParams: (uid, patch) =>
    get().edit(
      (d) => ({
        stages: d.stages.map((st) => (st.uid === uid ? { ...st, params: { ...(st.params as object), ...patch } } : st))
      }),
      { coalesce: `params:${uid}:${Object.keys(patch).join(',')}` }
    ),

  addPalette: (palette) => {
    const id = newId('pal')
    get().edit((d) => ({ palettes: [...d.palettes, { ...palette, id }] }))
    set({ selectedPaletteId: id })
    return id
  },
  updatePalette: (id, patch, opts) =>
    get().edit((d) => ({ palettes: d.palettes.map((p) => (p.id === id ? { ...p, ...patch } : p)) }), {
      coalesce: `palette:${id}:${Object.keys(patch).join(',')}`,
      ...opts
    }),
  removePalette: (id) => {
    const s = get()
    const rest = s.palettes.filter((p) => p.id !== id)
    s.edit((d) => ({
      palettes: d.palettes.filter((p) => p.id !== id),
      outputLock: d.outputLock.paletteId === id ? { ...d.outputLock, paletteId: rest[0]?.id ?? null } : d.outputLock
    }))
    if (s.selectedPaletteId === id) set({ selectedPaletteId: rest[0]?.id ?? null })
  }
}))
