import { create } from 'zustand'
import { MIN_VIEW_SPLIT, type Theme, type ViewMode } from '@shared/api'
import { DEFAULT_BAKE, DEFAULT_VIEW3D, type BakeSettings, type View3dSettings } from '@shared/bake'
import type { MapChannel, MapSlot } from '@shared/maps'
import type { StageSpec } from '@/gpu/plan'
import type { Palette } from '@/palette/palette'
import * as docOps from '@/stack/doc'
import type { Doc } from '@/stack/doc'
import {
  centered,
  fitView,
  splitAtVisibleCenter,
  splitVisible,
  stepZoom,
  TILES,
  zoomAt,
  type Size,
  type View
} from '@/viewer/viewport'

export interface ImageInfo {
  name: string
  width: number
  height: number
  /** Full path on disk, when known (the file then reloads when it changes). */
  path?: string
  /** Bumped on every load, so effects re-run even for same-named files. */
  version: number
}

/** An imported map (AO, cavity, …); its pixels live on the GPU (engine). */
export interface MapInfo {
  name: string
  width: number
  height: number
  /** Which part of the image is the mask (packed maps such as ORM use one channel each). */
  channel: MapChannel
  /** Changes with every load, so cached stages reading the map re-run. */
  version: number
  /** Small preview (data URL). */
  thumbnail: string | null
  /** Baked from the model (kept when another texture opens; the model's UVs place it). */
  baked?: boolean
  /** Full path on disk of the file it was loaded from, when known (it reloads when it changes). */
  path?: string
}

/** Summary of the loaded 3D model (its data lives in the engine). */
export interface ModelInfo {
  name: string
  /** Full path on disk, when known (textures it refers to are looked up next to it). */
  path?: string
  /** Paths of the files it was parsed with (glTF buffers, OBJ material libraries); they reload it too. */
  resources?: string[]
  triangles: number
  vertices: number
  uvSets: number
  materials: { name: string; triangles: number; texture: string | null }[]
  warnings: string[]
  /** Bumped on every load. */
  version: number
}

/** The project file the session was opened from or last saved to. */
export interface ProjectInfo {
  path: string
  /** File name without the extension. */
  name: string
  /** projectSignature() of the state as saved (or opened); a different one means unsaved changes. */
  saved: string
}

/** What the 3D view puts on the model: the result (as the viewer shows it), the source, or a map. */
export type View3dShow = 'result' | 'source' | MapSlot

export type BakeJob = { status: 'running'; progress: number; label: string } | { status: 'done'; label: string }

export type GpuState =
  | { status: 'loading' }
  | { status: 'ready'; adapter: string }
  | { status: 'error'; message: string }

export interface Message {
  text: string
  kind: 'info' | 'error'
}

/** The undoable part of the state (stages, palettes, output lock): what a preset file contains. */
export type { Doc }

export type PaletteJob = { status: 'running' } | { status: 'error'; message: string } | { status: 'blocked'; message: string }

/** Edits with the same key within this window merge into one undo step (e.g. a slider drag). */
const COALESCE_MS = 1000
const HISTORY_LIMIT = 200

export interface AppState extends Doc {
  gpu: GpuState
  image: ImageInfo | null
  view: View
  /** Viewer canvas size in device pixels. */
  canvasSize: Size
  grid: boolean
  split: boolean
  /** Tiling view: copies of the image around it, to check seams. */
  tile: boolean
  /** Interface theme (applied to <html> by theme.ts). */
  theme: Theme
  /** Split divider position as a fraction of the image width (moves with the image). */
  splitPos: number
  cursor: { x: number; y: number } | null
  message: Message | null
  diagnosticsOpen: boolean
  settingsOpen: boolean
  exportOpen: boolean
  presetsOpen: boolean
  /** Name of the last loaded or saved preset (suggested when saving). */
  presetName: string | null
  /** Bumped when the user's preset files change, so lists reload. */
  presetsVersion: number
  /** Stage whose output the viewer shows (null = final output). */
  previewUid: string | null
  /** Stage whose dither mask the viewer shows (null = none). */
  maskUid: string | null
  selectedPaletteId: string | null
  /** Color selected in the palette editor (index into that palette's colors). */
  selectedColor: { paletteId: string; index: number } | null
  /** Eyedropper armed: the next click in the viewer picks a color into the shown palette. */
  picking: boolean
  /** Auto/manual palette generation status by palette id (absent = idle). */
  paletteJobs: Record<string, PaletteJob>
  /** Imported maps by slot. They belong to the loaded texture, not to the (undoable) document. */
  maps: Partial<Record<MapSlot, MapInfo>>
  model: ModelInfo | null
  /** Material (texture set) the open texture belongs to: drawn with it in 3D and baked into. */
  modelMaterial: number
  /** UV set textures and bakes use. */
  modelUvSet: number
  /** Reload the texture, its maps and the model when their files change on disk. */
  liveReload: boolean
  /** Main view: the 2D viewer, 2D and 3D side by side, or the 3D view. */
  viewMode: ViewMode
  /** Share of the main view the 2D viewer gets side by side. */
  viewSplit: number
  view3d: View3dSettings
  view3dShow: View3dShow
  bake: BakeSettings
  bakeJob: BakeJob | null
  project: ProjectInfo | null
  /** Question of the "unsaved changes" dialog while it's open. */
  unsavedPrompt: string | null

  past: Doc[]
  future: Doc[]
  lastEdit: { key: string; at: number } | null

  setGpu(gpu: GpuState): void
  /** A new image; `keepView` keeps the zoom and pan when its size didn't change (a reload). */
  setImage(image: Omit<ImageInfo, 'version'>, opts?: { keepView?: boolean }): void
  setView(view: View): void
  setCanvasSize(size: Size): void
  zoomFit(): void
  zoomActual(): void
  zoomStep(dir: 1 | -1): void
  toggleGrid(): void
  setTheme(theme: Theme): void
  toggleSplit(): void
  toggleTile(): void
  setSplitPos(pos: number): void
  setCursor(cursor: { x: number; y: number } | null): void
  setMessage(message: Message | null): void
  setDiagnosticsOpen(open: boolean): void
  setSettingsOpen(open: boolean): void
  setExportOpen(open: boolean): void
  setPresetsOpen(open: boolean): void
  setPresetName(name: string | null): void
  presetsChanged(): void
  /** Replaces the whole document (e.g. loading a preset) as one undo step. */
  loadDoc(doc: Doc): void
  setPreview(uid: string | null): void
  setMaskView(uid: string | null): void
  selectPalette(id: string | null): void
  selectColor(selection: { paletteId: string; index: number } | null): void
  setPicking(picking: boolean): void
  setPaletteJob(id: string, job: PaletteJob | null): void
  setMap(slot: MapSlot, map: MapInfo | null): void
  setMapChannel(slot: MapSlot, channel: MapChannel): void
  clearMaps(): void
  setModel(model: Omit<ModelInfo, 'version'> | null, material?: number): void
  setModelMaterial(material: number): void
  setModelUvSet(uvSet: number): void
  setLiveReload(on: boolean): void
  setViewMode(mode: ViewMode): void
  setViewSplit(split: number): void
  setView3d(patch: Partial<View3dSettings>): void
  setView3dShow(show: View3dShow): void
  setBake(patch: Partial<BakeSettings>): void
  setBakeJob(job: BakeJob | null): void
  setProject(project: ProjectInfo | null): void
  setUnsavedPrompt(question: string | null): void
  /** Forgets undo history (a project was opened). */
  clearHistory(): void

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
  /** Palette stages: use a project palette, or their own palette generated from their input. */
  setStagePaletteSource(uid: string, source: 'palette' | 'generated'): void
  moveStage(uid: string, toIndex: number): void
  updateStage(uid: string, patch: Partial<Omit<StageSpec, 'uid' | 'passId'>>, coalesce?: string): void
  updateParams<P>(uid: string, patch: Partial<P>): void

  addPalette(palette: Omit<Palette, 'id'>): string
  updatePalette(id: string, patch: Partial<Omit<Palette, 'id'>>, opts?: { coalesce?: string; silent?: boolean }): void
  removePalette(id: string): void
}

export const newId = docOps.newId

/** Copies of the image per side the viewer draws (1, or TILES in the tiling view). */
export const tilesOf = (s: { tile: boolean }): number => (s.tile ? TILES : 1)

const snapshot = (s: Doc): Doc => ({ stages: s.stages, palettes: s.palettes, outputLock: s.outputLock })

const doc0 = docOps.initialDoc()

export const useApp = create<AppState>()((set, get) => ({
  ...doc0,
  gpu: { status: 'loading' },
  image: null,
  view: { zoom: 1, x: 0, y: 0 },
  canvasSize: { width: 0, height: 0 },
  grid: false,
  split: true,
  tile: false,
  theme: 'dark',
  splitPos: 0.5,
  cursor: null,
  message: null,
  diagnosticsOpen: false,
  settingsOpen: false,
  exportOpen: false,
  presetsOpen: false,
  presetName: null,
  presetsVersion: 0,
  previewUid: null,
  maskUid: null,
  selectedPaletteId: doc0.palettes[0]!.id,
  selectedColor: null,
  picking: false,
  paletteJobs: {},
  maps: {},
  model: null,
  modelMaterial: 0,
  modelUvSet: 0,
  liveReload: true,
  viewMode: '2d',
  viewSplit: 0.5,
  view3d: DEFAULT_VIEW3D,
  view3dShow: 'result',
  bake: DEFAULT_BAKE,
  bakeJob: null,
  project: null,
  unsavedPrompt: null,
  past: [],
  future: [],
  lastEdit: null,

  setGpu: (gpu) => set({ gpu }),
  setImage: (image, opts = {}) => {
    const prev = get().image
    const version = (prev?.version ?? 0) + 1
    const sameSize = prev?.width === image.width && prev.height === image.height
    const view = opts.keepView && sameSize ? get().view : fitView(image, get().canvasSize, undefined, tilesOf(get()))
    set({ image: { ...image, version }, view })
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
    set({ canvasSize, view: firstLayout ? fitView(image, canvasSize, undefined, tilesOf(get())) : shifted })
  },
  zoomFit: () => {
    const { image, canvasSize } = get()
    if (image) set({ view: fitView(image, canvasSize, undefined, tilesOf(get())) })
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
  setTheme: (theme) => set({ theme }),
  toggleSplit: () => {
    const { split, image, view, canvasSize, splitPos } = get()
    // Turning the split on with the divider off-screen: bring it to the middle of what's visible.
    if (!split && image && !splitVisible(view, image, canvasSize, splitPos)) {
      set({ split: true, splitPos: splitAtVisibleCenter(view, image, canvasSize, tilesOf(get())) })
    } else set({ split: !split })
  },
  toggleTile: () => {
    const tile = !get().tile
    // The divider may sit on a copy; bring it back onto the image when the copies go away.
    set(tile ? { tile } : { tile, splitPos: Math.min(Math.max(get().splitPos, 0), 1) })
  },
  setSplitPos: (splitPos) => {
    const side = (tilesOf(get()) - 1) / 2
    set({ splitPos: Math.min(Math.max(splitPos, -side), 1 + side) })
  },
  setCursor: (cursor) => set({ cursor }),
  setMessage: (message) => set({ message }),
  setDiagnosticsOpen: (diagnosticsOpen) => set({ diagnosticsOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setExportOpen: (exportOpen) => set({ exportOpen }),
  setPresetsOpen: (presetsOpen) => set({ presetsOpen }),
  setPresetName: (presetName) => set({ presetName }),
  presetsChanged: () => set({ presetsVersion: get().presetsVersion + 1 }),
  loadDoc: (doc) => {
    get().edit(() => doc)
    const firstStagePalette = doc.palettes.find((p) => p.ownerUid) ?? doc.palettes[0]
    set({ previewUid: null, maskUid: null, selectedPaletteId: firstStagePalette?.id ?? null })
  },
  setPreview: (previewUid) => set({ previewUid, maskUid: null }),
  setMaskView: (maskUid) => set({ maskUid }),
  selectPalette: (selectedPaletteId) => set({ selectedPaletteId }),
  selectColor: (selectedColor) => set({ selectedColor }),
  setPicking: (picking) => set({ picking }),
  setPaletteJob: (id, job) => {
    const jobs = { ...get().paletteJobs }
    if (job) jobs[id] = job
    else delete jobs[id]
    set({ paletteJobs: jobs })
  },

  setMap: (slot, map) => {
    const maps = { ...get().maps }
    if (map) maps[slot] = map
    else delete maps[slot]
    set({ maps })
  },
  setMapChannel: (slot, channel) => {
    const map = get().maps[slot]
    if (map) set({ maps: { ...get().maps, [slot]: { ...map, channel } } })
  },
  clearMaps: () => set({ maps: {} }),
  setModel: (model, material = 0) => {
    const version = (get().model?.version ?? 0) + 1
    set({ model: model && { ...model, version }, modelMaterial: material, modelUvSet: 0, bakeJob: null })
  },
  setModelMaterial: (modelMaterial) => set({ modelMaterial }),
  setModelUvSet: (modelUvSet) => set({ modelUvSet }),
  setLiveReload: (liveReload) => set({ liveReload }),
  setViewMode: (viewMode) => set({ viewMode }),
  setViewSplit: (split) => set({ viewSplit: Math.min(Math.max(split, MIN_VIEW_SPLIT), 1 - MIN_VIEW_SPLIT) }),
  setView3d: (patch) => set({ view3d: { ...get().view3d, ...patch } }),
  setView3dShow: (view3dShow) => set({ view3dShow }),
  setBake: (patch) => set({ bake: { ...get().bake, ...patch } }),
  setBakeJob: (bakeJob) => set({ bakeJob }),
  setProject: (project) => set({ project }),
  setUnsavedPrompt: (unsavedPrompt) => set({ unsavedPrompt }),
  clearHistory: () => set({ past: [], future: [], lastEdit: null }),

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
    const { stage, palettes } = docOps.makeStage(passId)
    get().edit((d) => {
      const stages = [...d.stages]
      stages.splice(index ?? stages.length, 0, stage)
      return { stages, palettes: [...d.palettes, ...palettes] }
    })
  },
  duplicateStage: (uid) => get().edit((d) => docOps.duplicateStage(d, uid)),
  removeStage: (uid) => {
    if (get().previewUid === uid) set({ previewUid: null })
    if (get().maskUid === uid) set({ maskUid: null })
    get().edit((d) => docOps.removeStage(d, uid))
  },
  setStagePaletteSource: (uid, source) => {
    const s = get()
    s.edit((d) =>
      source === 'generated' ? docOps.toGeneratedPalette(d, uid) : docOps.toProjectPalette(d, uid, s.selectedPaletteId)
    )
    // Show the stage's generated palette in the palette panel.
    const owned = docOps.ownedPalette(get(), uid)
    if (source === 'generated' && owned) set({ selectedPaletteId: owned.id })
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
