// How the 3D view draws the model: a look (built-in style such as Lit, Wireframe or PSX) or the
// user's Custom style, remembered between sessions (UserSettings.view3d).

/** Framebuffer heights of the 3D view: the window's resolution, or console-like line counts. */
export const VIEW3D_RESOLUTIONS = ['full', '480', '240'] as const
export type View3dResolution = (typeof VIEW3D_RESOLUTIONS)[number]

export const VIEW3D_SHADINGS = ['unlit', 'vertex', 'pixel'] as const
export const VIEW3D_SURFACES = ['texture', 'clay', 'normals'] as const
export const VIEW3D_WIREFRAMES = ['off', 'overlay', 'only'] as const
export const VIEW3D_FILTERS = ['nearest', 'bilinear', 'three-point'] as const
export const VIEW3D_COLOR_DEPTHS = ['full', 'rgb555'] as const
export const VIEW3D_DITHERS = ['none', 'psx', 'n64'] as const
export const VIEW3D_UPSCALES = ['sharp', 'smooth'] as const

/** Every setting of a 3D view style; the looks are presets of it. */
export interface View3dStyle {
  /** unlit = the texture's colors; vertex = gouraud (per-vertex light, like the consoles); pixel = per-pixel lights, shadows, specular. */
  shading: (typeof VIEW3D_SHADINGS)[number]
  /** What the surface shows: the texture, plain clay, or the surface normals as colors. */
  surface: (typeof VIEW3D_SURFACES)[number]
  /** Triangle edges: none, drawn over the surface, or alone (hidden lines removed). */
  wireframe: (typeof VIEW3D_WIREFRAMES)[number]
  resolution: View3dResolution
  /** Texture filtering: hard texels, bilinear, or the N64's 3-point filter. */
  filter: (typeof VIEW3D_FILTERS)[number]
  /** Vertices snap to whole pixels of a low-res grid (the PSX "wobble"). */
  snap: boolean
  /** Textures map linearly in screen space, not perspective-correct (the PSX warping). */
  affine: boolean
  /** Full color, or 5 bits per channel (15/16-bit, like the PSX and N64 framebuffers). */
  colorDepth: (typeof VIEW3D_COLOR_DEPTHS)[number]
  /** Ordered dither before cutting to 5 bits: the PSX's 4×4 matrix or the N64's magic square. */
  dither: (typeof VIEW3D_DITHERS)[number]
  /** How a low-res framebuffer scales up to the window: hard pixels, or smooth (like a TV). */
  upscale: (typeof VIEW3D_UPSCALES)[number]
  /** 4× multisampled edges. */
  antialias: boolean
  /** Draw the back of faces (off = back-face culling, which shows flipped faces as holes). */
  backfaces: boolean
  /** The key light casts shadows (per-pixel shading only). */
  shadows: boolean
  /** Ambient light, 0–1. */
  ambient: number
  /** Specular highlights, 0–1 (per-pixel shading only). */
  specular: number
  /** Per-pixel shading reads the AO, roughness and metallic maps when there are any. */
  maps: boolean
  /** Distance fog towards the background color, 0–1. */
  fog: number
}

export const VIEW3D_LOOKS = ['lit', 'unlit', 'wireframe', 'unlit-wire', 'clay', 'normals', 'psx', 'n64'] as const
export type View3dLook = (typeof VIEW3D_LOOKS)[number]
/** A look, or the user's own style. */
export type View3dLookChoice = View3dLook | 'custom'

/** Shapes the 3D view shows the texture on when no model is open. */
export const VIEW3D_SHAPES = ['cube', 'plane', 'sphere', 'sphere-tiled', 'torus'] as const
export type View3dShape = (typeof VIEW3D_SHAPES)[number]

export const VIEW3D_SHAPE_NAMES: Record<View3dShape, string> = {
  cube: 'Cube',
  plane: 'Plane',
  sphere: 'Sphere',
  'sphere-tiled': 'Sphere (2× tiling)',
  torus: 'Torus'
}

export interface View3dSettings {
  look: View3dLookChoice
  /** Shape shown when no model is open. */
  shape: View3dShape
  /** The Custom style: kept while another look is shown, and replaced when a look is edited. */
  custom: View3dStyle
}

const BASE: View3dStyle = {
  shading: 'pixel',
  surface: 'texture',
  wireframe: 'off',
  resolution: 'full',
  filter: 'nearest',
  snap: false,
  affine: false,
  colorDepth: 'full',
  dither: 'none',
  upscale: 'sharp',
  antialias: true,
  backfaces: true,
  shadows: true,
  ambient: 0.4,
  specular: 0.35,
  maps: true,
  fog: 0
}

const CONSOLE: View3dStyle = { ...BASE, shading: 'vertex', resolution: '240', antialias: false, shadows: false, ambient: 0.35, specular: 0, maps: false, colorDepth: 'rgb555' }

/** The built-in looks, in menu order. */
export const VIEW3D_LOOK_INFO: Record<View3dLook, { label: string; hint: string; style: View3dStyle }> = {
  lit: { label: 'Lit', hint: 'Lights, soft shadows and highlights; reads the AO, roughness and metallic maps.', style: BASE },
  unlit: { label: 'Unlit', hint: 'The texture’s exact colors, no light.', style: { ...BASE, shading: 'unlit', shadows: false } },
  wireframe: { label: 'Wireframe', hint: 'Triangle edges only, hidden lines removed.', style: { ...BASE, shading: 'unlit', wireframe: 'only', shadows: false } },
  'unlit-wire': { label: 'Unlit + Wireframe', hint: 'The unlit texture with the triangle edges over it.', style: { ...BASE, shading: 'unlit', wireframe: 'overlay', shadows: false } },
  clay: { label: 'Clay', hint: 'The shape alone: gray clay, lights and shadows, no texture.', style: { ...BASE, surface: 'clay', specular: 0.3 } },
  normals: { label: 'Normals', hint: 'Surface directions as colors (world space): spots flipped or smoothed normals.', style: { ...BASE, shading: 'unlit', surface: 'normals', shadows: false } },
  psx: {
    label: 'PSX',
    hint: 'PlayStation: 240 lines, wobbling vertices, warping textures, hard texels, 15-bit color with the 4×4 dither.',
    style: { ...CONSOLE, snap: true, affine: true, dither: 'psx' }
  },
  n64: {
    label: 'N64',
    hint: 'Nintendo 64: 240 lines, 3-point filtered textures, 16-bit color with the magic-square dither, edge antialiasing and a soft picture.',
    style: { ...CONSOLE, filter: 'three-point', dither: 'n64', upscale: 'smooth', antialias: true }
  }
}

export const DEFAULT_VIEW3D: View3dSettings = { look: 'lit', shape: 'cube', custom: VIEW3D_LOOK_INFO.psx.style }

/** The style a look (or Custom) draws with. */
export function view3dStyle(settings: View3dSettings): View3dStyle {
  return settings.look === 'custom' ? settings.custom : VIEW3D_LOOK_INFO[settings.look].style
}

/** Settings after editing the shown style: the edit makes (or changes) the Custom style. */
export function customizeView3d(settings: View3dSettings, patch: Partial<View3dStyle>): View3dSettings {
  return { ...settings, look: 'custom', custom: { ...view3dStyle(settings), ...patch } }
}

export function sameView3dStyle(a: View3dStyle, b: View3dStyle): boolean {
  return (Object.keys(BASE) as (keyof View3dStyle)[]).every((k) => a[k] === b[k])
}

const pick = <T extends string>(options: readonly T[], v: unknown, fallback: T): T => (options.includes(v as T) ? (v as T) : fallback)
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)
const unit = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : fallback)

export function normalizeView3dStyle(raw: unknown, fallback: View3dStyle = BASE): View3dStyle {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return {
    shading: pick(VIEW3D_SHADINGS, r.shading, fallback.shading),
    surface: pick(VIEW3D_SURFACES, r.surface, fallback.surface),
    wireframe: pick(VIEW3D_WIREFRAMES, r.wireframe, fallback.wireframe),
    resolution: pick(VIEW3D_RESOLUTIONS, r.resolution, fallback.resolution),
    filter: pick(VIEW3D_FILTERS, r.filter, fallback.filter),
    snap: bool(r.snap, fallback.snap),
    affine: bool(r.affine, fallback.affine),
    colorDepth: pick(VIEW3D_COLOR_DEPTHS, r.colorDepth, fallback.colorDepth),
    dither: pick(VIEW3D_DITHERS, r.dither, fallback.dither),
    upscale: pick(VIEW3D_UPSCALES, r.upscale, fallback.upscale),
    antialias: bool(r.antialias, fallback.antialias),
    backfaces: bool(r.backfaces, fallback.backfaces),
    shadows: bool(r.shadows, fallback.shadows),
    ambient: unit(r.ambient, fallback.ambient),
    specular: unit(r.specular, fallback.specular),
    maps: bool(r.maps, fallback.maps),
    fog: unit(r.fog, fallback.fog)
  }
}

/**
 * Older settings were one set of PSX switches (snap, affine, filter, lighting, dither): with any
 * quirk on they become the Custom style, otherwise the default look.
 */
function fromPsxSwitches(r: Record<string, unknown>): View3dSettings {
  const on = (k: string): boolean => r[k] === true
  const resolution = pick(VIEW3D_RESOLUTIONS, r.resolution, 'full')
  if (!on('snap') && !on('affine') && !on('filter') && !on('dither') && resolution === 'full') return DEFAULT_VIEW3D
  return {
    look: 'custom',
    shape: DEFAULT_VIEW3D.shape,
    custom: {
      ...CONSOLE,
      shading: r.lighting === false ? 'unlit' : 'vertex',
      resolution,
      snap: on('snap'),
      affine: on('affine'),
      filter: on('filter') ? 'bilinear' : 'nearest',
      colorDepth: on('dither') ? 'rgb555' : 'full',
      dither: on('dither') ? 'psx' : 'none'
    }
  }
}

export function normalizeView3d(raw: unknown): View3dSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  if (!('look' in r) && ('snap' in r || 'affine' in r || 'dither' in r || 'lighting' in r)) return fromPsxSwitches(r)
  return {
    look: r.look === 'custom' ? 'custom' : pick(VIEW3D_LOOKS, r.look, DEFAULT_VIEW3D.look),
    shape: pick(VIEW3D_SHAPES, r.shape, DEFAULT_VIEW3D.shape),
    custom: normalizeView3dStyle(r.custom, DEFAULT_VIEW3D.custom)
  }
}
