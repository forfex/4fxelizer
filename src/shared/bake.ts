// Settings of the 3D view's PSX look and of map baking, remembered between sessions (UserSettings).

import type { MapSlot } from './maps'

/** Maps the app bakes from a model, in the order they're listed. */
export const BAKE_MAPS = ['ao', 'cavity', 'curvature', 'edge', 'thickness', 'height', 'up'] as const satisfies readonly MapSlot[]
export type BakeMap = (typeof BAKE_MAPS)[number]

/** Bake resolutions offered (square, in texels). */
export const BAKE_SIZES = [256, 512, 1024, 2048, 4096] as const

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
  size: { min: 64, max: 4096, value: 1024, integer: true },
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

export const DEFAULT_VIEW3D: View3dSettings = { snap: true, affine: true, resolution: '240', filter: false, lighting: true, dither: true }

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
