// Settings of the 3D view's PSX look and of map baking, remembered between sessions (UserSettings).

import type { MapSlot } from './maps'

/** Maps the app bakes from a model, in the order they're listed. */
export const BAKE_MAPS = ['ao', 'cavity', 'curvature', 'edge', 'thickness', 'height', 'up'] as const satisfies readonly MapSlot[]
export type BakeMap = (typeof BAKE_MAPS)[number]

/**
 * Bake resolutions offered (square, in texels). Masks read maps by UV, so they needn't match the
 * texture; 2048 keeps each G-buffer array at 64 MB (a GPU storage binding may be capped at 128 MB).
 */
export const BAKE_SIZES = [256, 512, 1024, 2048] as const

export interface BakeSettings {
  size: number
  /** Texels UV islands grow outward, so maps don't show seams when sampled or downscaled. */
  padding: number
  maps: Record<BakeMap, boolean>
  aoSamples: number
  /** How far AO rays look, as a fraction of the model's size (its bounding box diagonal). */
  aoDistance: number
  /** 0 = every hit darkens fully; 1 = far hits darken less. */
  aoFalloff: number
  /** Hits on the back of faces don't count (open meshes, inside-out parts). */
  aoIgnoreBackfaces: boolean
  cavitySamples: number
  cavityDistance: number
  /** Probes of the curvature and edge maps (baked together). */
  edgeSamples: number
  /** How wide edges and creases read, as a fraction of the model's size. */
  edgeWidth: number
  /** Contrast of the curvature and edge maps. */
  edgeStrength: number
  thicknessSamples: number
  thicknessDistance: number
}

type NumberKey = { [K in keyof BakeSettings]: BakeSettings[K] extends number ? K : never }[keyof BakeSettings]

/** Range and default of every numeric bake setting. */
export const BAKE_NUMBERS: Record<NumberKey, { min: number; max: number; value: number; integer?: boolean }> = {
  size: { min: 64, max: 2048, value: 1024, integer: true },
  padding: { min: 0, max: 64, value: 8, integer: true },
  aoSamples: { min: 4, max: 1024, value: 128, integer: true },
  aoDistance: { min: 0.001, max: 1, value: 0.15 },
  aoFalloff: { min: 0, max: 1, value: 0.5 },
  cavitySamples: { min: 4, max: 1024, value: 64, integer: true },
  cavityDistance: { min: 0.001, max: 0.2, value: 0.02 },
  edgeSamples: { min: 4, max: 1024, value: 32, integer: true },
  edgeWidth: { min: 0.001, max: 0.1, value: 0.01 },
  edgeStrength: { min: 0.1, max: 8, value: 2 },
  thicknessSamples: { min: 4, max: 1024, value: 64, integer: true },
  thicknessDistance: { min: 0.01, max: 1, value: 0.25 }
}

export const DEFAULT_BAKE: BakeSettings = {
  ...(Object.fromEntries(Object.entries(BAKE_NUMBERS).map(([k, v]) => [k, v.value])) as Record<NumberKey, number>),
  maps: { ao: true, cavity: true, curvature: true, edge: true, thickness: false, height: false, up: false },
  aoIgnoreBackfaces: false
}

export function normalizeBake(raw: unknown): BakeSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const out = { ...DEFAULT_BAKE, maps: { ...DEFAULT_BAKE.maps } }
  for (const [key, spec] of Object.entries(BAKE_NUMBERS) as [NumberKey, (typeof BAKE_NUMBERS)[NumberKey]][]) {
    const v = r[key]
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    const clamped = Math.min(Math.max(v, spec.min), spec.max)
    out[key] = spec.integer ? Math.round(clamped) : clamped
  }
  if (typeof r.aoIgnoreBackfaces === 'boolean') out.aoIgnoreBackfaces = r.aoIgnoreBackfaces
  const maps = r.maps as Record<string, unknown> | undefined
  if (typeof maps === 'object' && maps !== null) {
    for (const m of BAKE_MAPS) if (typeof maps[m] === 'boolean') out.maps[m] = maps[m] as boolean
  }
  return out
}

/** Bake settings saved under a name (Bake panel › Preset). */
export interface BakePreset {
  name: string
  settings: BakeSettings
}

/** Most bake presets a user keeps (oldest dropped first). */
export const MAX_BAKE_PRESETS = 32

const bakeWith = (patch: Partial<BakeSettings>): BakeSettings => normalizeBake({ ...DEFAULT_BAKE, ...patch, maps: { ...DEFAULT_BAKE.maps, ...patch.maps } })
const onlyMaps = (...maps: BakeMap[]): Record<BakeMap, boolean> =>
  Object.fromEntries(BAKE_MAPS.map((m) => [m, maps.includes(m)])) as Record<BakeMap, boolean>

/** Built-in bake presets, from a fast preview to final quality and settings tuned per kind of model. */
export const BUILTIN_BAKE_PRESETS: (BakePreset & { hint: string })[] = [
  {
    name: 'Quick preview',
    hint: 'AO and cavity at 512², few samples: a fast first look (noisy).',
    settings: bakeWith({ size: 512, padding: 4, aoSamples: 32, cavitySamples: 16, edgeSamples: 8, thicknessSamples: 16, maps: onlyMaps('ao', 'cavity') })
  },
  { name: 'Balanced', hint: 'The default: AO, cavity, curvature and edge at 1024².', settings: DEFAULT_BAKE },
  {
    name: 'Final quality',
    hint: 'AO, cavity, curvature and edge at 2048² with many samples: smooth, slow.',
    settings: bakeWith({ size: 2048, padding: 16, aoSamples: 512, cavitySamples: 256, edgeSamples: 128, thicknessSamples: 256 })
  },
  {
    name: 'Hard surface',
    hint: 'Machines, props, architecture: tight AO, thin crisp edges and creases.',
    settings: bakeWith({ aoDistance: 0.1, aoFalloff: 0.3, cavityDistance: 0.01, edgeSamples: 64, edgeWidth: 0.005, edgeStrength: 3 })
  },
  {
    name: 'Organic',
    hint: 'Characters, creatures, rocks: wide soft AO, gentle curvature and thickness (for skin and leaves).',
    settings: bakeWith({
      aoDistance: 0.25,
      aoFalloff: 0.7,
      cavityDistance: 0.03,
      edgeWidth: 0.02,
      edgeStrength: 1.5,
      maps: onlyMaps('ao', 'cavity', 'curvature', 'thickness')
    })
  },
  {
    name: 'Weathering',
    hint: 'Every map dirt, dust and wear masks need: AO, cavity, edge, height and up-facing.',
    settings: bakeWith({ maps: onlyMaps('ao', 'cavity', 'edge', 'height', 'up') })
  },
  {
    name: 'Open meshes',
    hint: 'Foliage, cloth and single-sided parts: back faces are ignored, so AO does not go black inside.',
    settings: bakeWith({ aoIgnoreBackfaces: true, aoDistance: 0.1, maps: onlyMaps('ao', 'cavity', 'thickness') })
  }
]

/** Whether two bake settings are the same (a preset is "current" when it matches the panel). */
export function sameBake(a: BakeSettings, b: BakeSettings): boolean {
  return (
    (Object.keys(BAKE_NUMBERS) as NumberKey[]).every((k) => a[k] === b[k]) &&
    a.aoIgnoreBackfaces === b.aoIgnoreBackfaces &&
    BAKE_MAPS.every((m) => a.maps[m] === b.maps[m])
  )
}

export function normalizeBakePresets(raw: unknown): BakePreset[] {
  if (!Array.isArray(raw)) return []
  const byName = new Map<string, BakePreset>()
  for (const p of raw) {
    if (typeof p !== 'object' || p === null) continue
    const { name, settings } = p as Record<string, unknown>
    if (typeof name !== 'string' || !name.trim() || typeof settings !== 'object' || settings === null) continue
    const trimmed = name.trim().slice(0, 100)
    byName.delete(trimmed) // a later entry with the same name wins
    byName.set(trimmed, { name: trimmed, settings: normalizeBake(settings) })
  }
  return [...byName.values()].slice(-MAX_BAKE_PRESETS)
}

/** Framebuffer heights of the 3D view: the window's resolution, or PSX-like line counts. */
export const VIEW3D_RESOLUTIONS = ['full', '480', '240'] as const
export type View3dResolution = (typeof VIEW3D_RESOLUTIONS)[number]

/** How the 3D view draws the model: each PSX quirk can be switched on or off. */
export interface View3dSettings {
  /** Vertices snap to whole pixels of a low-res grid (the PSX "wobble"). */
  snap: boolean
  /** Textures map linearly in screen space, not perspective-correct (the PSX warping). */
  affine: boolean
  resolution: View3dResolution
  /** Bilinear texture filtering (off = nearest texel, like the PSX). */
  filter: boolean
  /** Simple directional light with ambient. */
  lighting: boolean
  /** 15-bit color with the PSX's 4×4 ordered dither. */
  dither: boolean
}

export const DEFAULT_VIEW3D: View3dSettings = { snap: false, affine: false, resolution: 'full', filter: false, lighting: true, dither: false }

export function normalizeView3d(raw: unknown): View3dSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const bool = (k: 'snap' | 'affine' | 'filter' | 'lighting' | 'dither'): boolean => (typeof r[k] === 'boolean' ? (r[k] as boolean) : DEFAULT_VIEW3D[k])
  return {
    snap: bool('snap'),
    affine: bool('affine'),
    resolution: VIEW3D_RESOLUTIONS.includes(r.resolution as View3dResolution) ? (r.resolution as View3dResolution) : DEFAULT_VIEW3D.resolution,
    filter: bool('filter'),
    lighting: bool('lighting'),
    dither: bool('dither')
  }
}
