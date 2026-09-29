import type { PaletteParams } from '@/stack/doc'
import { MASK_SOURCES, maskMaps, type MaskCombine, type MaskSource, type MaskSpec } from '../mask'
import { decodePattern } from '@/dither/customPattern'
import { definePass, packStruct, ROW_THREADS } from '../pass'
import type { ColorMetric } from './quantize'

/**
 * Dither algorithms. `ordered` ones compare each pixel with a threshold pattern (parallel, tile when
 * `period` divides the texture), `diffusion` ones push each pixel's error onto its neighbors.
 * Append new entries: a pattern's position is its shader index.
 */
export const DITHER_PATTERNS = [
  { id: 'bayer2', label: 'Bayer 2×2', kind: 'ordered', period: 2 },
  { id: 'bayer4', label: 'Bayer 4×4', kind: 'ordered', period: 4 },
  { id: 'bayer8', label: 'Bayer 8×8', kind: 'ordered', period: 8 },
  { id: 'bayer16', label: 'Bayer 16×16', kind: 'ordered', period: 16 },
  { id: 'blue-noise', label: 'Blue noise', kind: 'ordered', period: 64 },
  { id: 'white-noise', label: 'White noise', kind: 'ordered', period: 0 },
  { id: 'ign', label: 'Interleaved gradient noise', kind: 'ordered', period: 0 },
  { id: 'cluster4', label: 'Clustered dots 4×4', kind: 'ordered', period: 4 },
  { id: 'cluster8', label: 'Clustered dots 8×8', kind: 'ordered', period: 8 },
  { id: 'halftone', label: 'Halftone 45°', kind: 'ordered', period: 8 },
  { id: 'lines-h', label: 'Lines, horizontal', kind: 'ordered', period: 4 },
  { id: 'lines-v', label: 'Lines, vertical', kind: 'ordered', period: 4 },
  { id: 'lines-d', label: 'Lines, diagonal', kind: 'ordered', period: 4 },
  { id: 'floyd-steinberg', label: 'Floyd–Steinberg', kind: 'diffusion', period: 0 },
  { id: 'atkinson', label: 'Atkinson', kind: 'diffusion', period: 0 },
  { id: 'jarvis', label: 'Jarvis–Judice–Ninke', kind: 'diffusion', period: 0 },
  { id: 'stucki', label: 'Stucki', kind: 'diffusion', period: 0 },
  { id: 'burkes', label: 'Burkes', kind: 'diffusion', period: 0 },
  { id: 'sierra', label: 'Sierra', kind: 'diffusion', period: 0 },
  { id: 'sierra2', label: 'Sierra two-row', kind: 'diffusion', period: 0 },
  { id: 'sierra-lite', label: 'Sierra Lite', kind: 'diffusion', period: 0 },
  { id: 'n64-magic', label: 'N64 magic square', kind: 'ordered', period: 4 },
  { id: 'checker', label: 'Checker', kind: 'ordered', period: 2 },
  { id: 'crosshatch', label: 'Crosshatch', kind: 'ordered', period: 8 },
  { id: 'custom', label: 'Custom image', kind: 'ordered', period: -1 }
] as const

export type DitherPattern = (typeof DITHER_PATTERNS)[number]['id']

export const DITHER_MODES = [
  { id: 'palette', label: 'Palette', hint: 'To palette: pattern and palette snap together (classic dithering).' },
  { id: 'levels', label: 'Levels', hint: 'To levels: N levels per channel, e.g. 32 = 5-bit PSX color.' },
  { id: 'pattern', label: 'Pattern', hint: 'Pattern only: adds the pattern without snapping; a later Quantize does the snap.' }
] as const

export type DitherMode = (typeof DITHER_MODES)[number]['id']

/** How an ordered pattern picks between palette colors. */
export const DITHER_MIXING = [
  { id: 'offset', label: 'Offset', hint: 'Shift each pixel by the pattern, then take the nearest color.' },
  { id: 'two-nearest', label: 'Two nearest', hint: 'Mix only the two palette colors closest to each pixel: cleaner, less noisy.' },
  { id: 'knoll', label: 'Knoll', hint: 'Pattern dithering (Knoll): mixes several palette colors for accurate shades. Best for small palettes.' }
] as const

export type DitherMixing = (typeof DITHER_MIXING)[number]['id']

/** Where the dither is applied (the rest of the image gets less of it); see gpu/mask.ts. */
export const DITHER_MASKS = MASK_SOURCES

export type DitherMask = MaskSource

/** Pattern used outside the mask: 'none' = the same pattern, just weaker there. */
export type OutsidePattern = DitherPattern | 'none'

export interface DitherParams extends PaletteParams {
  pattern: DitherPattern
  mode: DitherMode
  metric: ColorMetric
  levels: number
  /** 0 = no dithering, 1 = full. */
  strength: number
  /** Screen texels per pattern cell (1 = finest). Ordered patterns only. */
  scale: number
  /** Legacy switch for `mixing: 'two-nearest'` (kept so older presets load unchanged). */
  twoNearest: boolean
  mixing: DitherMixing
  /** Colors Knoll mixing picks from per pixel. */
  knollCount: number
  /**
   * Color of the dither. Ordered: 0 = the same pattern on every channel (brightness only),
   * 1 = each channel its own phase. Diffusion: how much of the color (not brightness) error spreads.
   */
  saturation: number
  mask: DitherMask
  maskInvert: boolean
  /** Second mask source, combined with the first ('none' = only the first). */
  mask2: DitherMask
  mask2Invert: boolean
  maskCombine: MaskCombine
  /** Mask blur radius in pixels. */
  maskBlur: number
  /** 0 = mask ignored, 1 = dither fully follows the mask. */
  maskStrength: number
  /** Shapes the mask: < 1 widens it, > 1 narrows it. */
  maskGamma: number
  /** Different pattern where the mask is dark (below 50%). */
  outsidePattern: OutsidePattern
  /** Strength of the outside pattern. */
  outsideStrength: number
  /** dither: alpha becomes 0/1 using the pattern (dithered cutout). */
  alpha: 'keep' | 'dither'
  /** Error diffusion: every other row runs right to left (fewer diagonal "worms"). */
  serpentine: boolean
  /**
   * Tiling: error diffusion sends error leaving one edge back in on the opposite one (slower: rows
   * run one at a time), and mask edge detection and blur wrap around.
   */
  wrap: boolean
  /** Pattern image for the 'custom' pattern (encoded, see dither/customPattern.ts); '' = none. */
  customPattern: string
  /** File name the custom pattern came from (shown in the editor). */
  customPatternName: string
  /** Output the mask instead of the dithered image (viewer only, never stored). */
  showMask?: boolean
}

export const DEFAULT_DITHER: DitherParams = {
  pattern: 'bayer4',
  mode: 'palette',
  paletteId: null,
  autoColors: 16,
  projectPaletteId: null,
  metric: 'oklab',
  levels: 32,
  strength: 0.5,
  scale: 1,
  twoNearest: false,
  mixing: 'offset',
  knollCount: 8,
  saturation: 0,
  mask: 'none',
  maskInvert: false,
  mask2: 'none',
  mask2Invert: false,
  maskCombine: 'multiply',
  maskBlur: 0,
  maskStrength: 1,
  maskGamma: 1,
  outsidePattern: 'none',
  outsideStrength: 0.5,
  alpha: 'keep',
  serpentine: false,
  wrap: false,
  customPattern: '',
  customPatternName: ''
}

export function isDiffusion(pattern: DitherPattern): boolean {
  return DITHER_PATTERNS.find((d) => d.id === pattern)?.kind === 'diffusion'
}

/** Effective mixing, honoring the legacy `twoNearest` switch. */
export function ditherMixing(p: DitherParams): DitherMixing {
  return p.mixing === 'offset' && p.twoNearest ? 'two-nearest' : p.mixing
}

/** The mask the stage builds, or null when it has none. */
export function ditherMask(p: DitherParams): MaskSpec | null {
  if (p.mask === 'none' && p.mask2 === 'none') return null
  const [a, aInvert, b, bInvert] =
    p.mask === 'none' ? [p.mask2, p.mask2Invert, 'none' as const, false] : [p.mask, p.maskInvert, p.mask2, p.mask2Invert]
  return { a, aInvert, b, bInvert, combine: p.maskCombine, blur: p.maskBlur, wrap: p.wrap }
}

/** The pattern used outside the mask, or null when there is none. */
export function outsidePattern(p: DitherParams): DitherPattern | null {
  return p.outsidePattern !== 'none' && ditherMask(p) ? p.outsidePattern : null
}

/** Whether a pattern is used (inside or outside the mask). */
export function usesPattern(p: DitherParams, pattern: DitherPattern): boolean {
  return p.pattern === pattern || outsidePattern(p) === pattern
}

/** Horizontal and vertical period of a pattern in texels (0 = never repeats). */
function patternPeriod(pattern: DitherPattern, p: DitherParams): { x: number; y: number } {
  const scale = isDiffusion(pattern) ? 1 : Math.max(1, Math.round(p.scale))
  if (pattern === 'custom') {
    const image = decodePattern(p.customPattern)
    return { x: (image?.width ?? 1) * scale, y: (image?.height ?? 1) * scale }
  }
  const period = DITHER_PATTERNS.find((d) => d.id === pattern)?.period ?? 0
  return { x: period * scale, y: period * scale }
}

/**
 * Pattern period in texels; ordered patterns tile seamlessly when this divides the texture size.
 * 0 = the pattern never repeats (noise, error diffusion; see `ditherTiling` for wrap-around).
 * Custom images: the larger side.
 */
export function ditherPeriod(p: DitherParams): number {
  const { x, y } = patternPeriod(p.pattern, p)
  return Math.max(x, y)
}

/** Why the dithered result won't tile on a texture of `size`, or null when it tiles seamlessly. */
export function ditherTiling(p: DitherParams, size: { width: number; height: number }): string | null {
  const patterns = [p.pattern, outsidePattern(p)].filter((d): d is DitherPattern => !!d)
  for (const pattern of patterns) {
    const name = DITHER_PATTERNS.find((d) => d.id === pattern)?.label ?? pattern
    const period = patternPeriod(pattern, p)
    if (isDiffusion(pattern)) {
      if (!p.wrap) return `${name} won't tile seamlessly. Turn on "Wrap edges" for tiling textures.`
    } else if (period.x === 0) {
      return `${name} doesn't repeat, so the texture won't tile seamlessly. Use an ordered pattern for tiling textures.`
    } else if (size.width % period.x !== 0 || size.height % period.y !== 0) {
      const px = period.x === period.y ? `${period.x}px` : `${period.x}×${period.y}px`
      return `The ${px} pattern doesn't divide ${size.width}×${size.height}, so the texture won't tile seamlessly.`
    }
  }
  const mask = ditherMask(p)
  const filtered = mask && (mask.blur > 0 || [mask.a, mask.b].some((s) => s === 'edges' || s === 'flats'))
  if (filtered && !p.wrap) return 'The mask stops at the image edges. Turn on "Wrap edges" for tiling textures.'
  return null
}

/** Whether the dithered result tiles seamlessly on a texture of `size`. */
export function ditherTiles(p: DitherParams, size: { width: number; height: number }): boolean {
  return ditherTiling(p, size) === null
}

/**
 * Error diffusion kernels: weights for (x+1, x+2) on the current row, then x-2…x+2 on the next
 * two rows, and the divisor.
 */
const KERNELS: Partial<Record<DitherPattern, { w: number[]; div: number }>> = {
  'floyd-steinberg': { w: [7, 0, 0, 3, 5, 1, 0, 0, 0, 0, 0, 0], div: 16 },
  atkinson: { w: [1, 1, 0, 1, 1, 1, 0, 0, 0, 1, 0, 0], div: 8 },
  jarvis: { w: [7, 5, 3, 5, 7, 5, 3, 1, 3, 5, 3, 1], div: 48 },
  stucki: { w: [8, 4, 2, 4, 8, 4, 2, 1, 2, 4, 2, 1], div: 42 },
  burkes: { w: [8, 4, 2, 4, 8, 4, 2, 0, 0, 0, 0, 0], div: 32 },
  sierra: { w: [5, 3, 2, 4, 5, 4, 2, 0, 2, 3, 2, 0], div: 32 },
  sierra2: { w: [4, 3, 1, 2, 3, 2, 1, 0, 0, 0, 0, 0], div: 16 },
  'sierra-lite': { w: [2, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0], div: 4 }
}

/** Kernel weights, normalized (zeros for ordered patterns). */
export function diffusionKernel(pattern: DitherPattern): number[] {
  const k = KERNELS[pattern]
  return k ? k.w.map((w) => w / k.div) : new Array<number>(12).fill(0)
}

/** Ring of error rows kept in scratch; see `runRows`. Must exceed ROW_THREADS + 2. */
const RING_ROWS = ROW_THREADS + 4
/** Rows run before the real scan with wrap-around, so the top rows start with the bottom's error. */
const WARMUP_ROWS = 32
/** Pixels per dispatch of the one-thread (serpentine / wrap-around) scan; see PassDef.serialSteps. */
const SEQUENTIAL_STEP_PIXELS = 65536

/** Rows of the one-thread scan (warm-up included) and how many run per dispatch. */
function sequentialRows(p: DitherParams, size: { width: number; height: number }): { total: number; perStep: number } {
  const warm = p.wrap ? Math.min(size.height, WARMUP_ROWS) : 0
  return { total: warm + size.height, perStep: Math.max(1, Math.floor(SEQUENTIAL_STEP_PIXELS / Math.max(size.width, 1))) }
}

const index = <T extends { id: string }>(list: readonly T[], id: string): number =>
  Math.max(0, list.findIndex((d) => d.id === id))

export const dither = definePass<DitherParams>({
  id: 'dither',
  label: 'Dither',
  wgsl: /* wgsl */ `
struct Params {
  pattern: u32, mode: u32, metric: u32, levels: f32,
  strength: f32, scale: u32, mixing: u32, alphaMode: u32,
  saturation: f32, hasMask: u32, maskStrength: f32, maskGamma: f32,
  knollCount: u32, showMask: u32, serpentine: u32, wrap: u32,
  outside: u32, outsideStrength: f32, diffuseIn: u32, diffuseOut: u32,
  // Diffusion kernels inside (k*) and outside (o*) the mask, see diffusionKernel().
  k0: vec4f, k1: vec4f, k2: vec4f,
  o0: vec4f, o1: vec4f, o2: vec4f,
}

const RING_ROWS = ${RING_ROWS}u;
const WARMUP_ROWS = ${WARMUP_ROWS}u;
const SEQUENTIAL_STEP_PIXELS = ${SEQUENTIAL_STEP_PIXELS}u;
const TAU = 6.283185307;

// Classic 4×4 clustered-dot matrix (dots grow from the center of each cell).
var<private> CLUSTER4: array<u32, 16> = array<u32, 16>(12u, 5u, 6u, 13u, 4u, 0u, 1u, 7u, 11u, 3u, 2u, 8u, 15u, 10u, 9u, 14u);
// Nintendo 64 RDP "magic square" dither matrix (values 0..7).
var<private> MAGIC4: array<u32, 16> = array<u32, 16>(0u, 6u, 1u, 7u, 4u, 2u, 5u, 3u, 3u, 5u, 2u, 4u, 7u, 1u, 6u, 0u);
// Line screen: the two middle rows of each 4-row cell fill first.
var<private> LINE4: array<f32, 4> = array<f32, 4>(2.0, 0.0, 1.0, 3.0);

fn whiteNoise(p: vec2u) -> f32 {
  var h = (p.x * 0x8da6b343u) ^ (p.y * 0xd8163841u);
  h = (h ^ (h >> 16u)) * 0x7feb352du;
  h = (h ^ (h >> 15u)) * 0x846ca68bu;
  h = h ^ (h >> 16u);
  return (f32(h >> 8u) + 0.5) / 16777216.0;
}

fn ign(p: vec2u) -> f32 {
  let v = vec2f(p);
  return fract(52.9829189 * fract(0.06711056 * v.x + 0.00583715 * v.y));
}

/** Spot function: cells with lower values turn on first. */
fn spotValue(kind: u32, q: vec2u, n: u32) -> f32 {
  let c = vec2f(q) + 0.5;
  if (kind == 0u) {
    let d = c - f32(n) * 0.5;
    return dot(d, d);
  }
  return -cos(TAU * c.x / f32(n)) * cos(TAU * c.y / f32(n));
}

/**
 * Crosshatch spot values: diagonal lines turn on first (one direction, then the other), then
 * lines between them, then the rest in Bayer order.
 */
fn hatchValue(q: vec2u) -> f32 {
  let d1 = (q.x + 8u - q.y) % 8u;
  let d2 = (q.x + q.y) % 8u;
  var layer = 4.0;
  if (d1 == 0u) { layer = 0.0; }
  else if (d2 == 0u) { layer = 1.0; }
  else if (d1 == 4u) { layer = 2.0; }
  else if (d2 == 4u) { layer = 3.0; }
  return layer + bayer(q, 8u);
}

fn spot(kind: u32, q: vec2u, n: u32) -> f32 {
  if (kind == 2u) { return hatchValue(q); }
  return spotValue(kind, q, n);
}

/** Rank of the cell within its n×n tile by spot value, as an evenly distributed threshold. */
fn rankThreshold(p: vec2u, kind: u32, n: u32) -> f32 {
  let q = p % n;
  let v = spot(kind, q, n);
  let qi = q.y * n + q.x;
  var rank = 0u;
  for (var j = 0u; j < n * n; j++) {
    let o = spot(kind, vec2u(j % n, j / n), n);
    if (o < v || (o == v && j < qi)) { rank++; }
  }
  return (f32(rank) + 0.5) / f32(n * n);
}

fn threshold(p: vec2u, pattern: u32) -> f32 {
  let q = p / max(params.scale, 1u);
  switch pattern {
    case 0u: { return bayer(q, 2u); }
    case 1u: { return bayer(q, 4u); }
    case 2u: { return bayer(q, 8u); }
    case 3u: { return bayer(q, 16u); }
    case 5u: { return whiteNoise(q); }
    case 6u: { return ign(q); }
    case 7u: { return (f32(CLUSTER4[(q.y % 4u) * 4u + q.x % 4u]) + 0.5) / 16.0; }
    case 8u: { return rankThreshold(q, 0u, 8u); }
    case 9u: { return rankThreshold(q, 1u, 8u); }
    case 10u: { return (LINE4[q.y % 4u] + 0.5) / 4.0; }
    case 11u: { return (LINE4[q.x % 4u] + 0.5) / 4.0; }
    case 12u: { return (LINE4[(q.x + q.y) % 4u] + 0.5) / 4.0; }
    case 21u: { return (f32(MAGIC4[(q.y % 4u) * 4u + q.x % 4u]) + 0.5) / 8.0; }
    case 22u: { return select(0.25, 0.75, ((q.x + q.y) & 1u) == 1u); }
    case 23u: { return rankThreshold(q, 2u, 8u); }
    case 24u: { return textureLoad(customPattern, q % textureDimensions(customPattern), 0).r; }
    default: { return blueNoise(q); }
  }
}

// ── Mask ────────────────────────────────────────────────────────────────────

/** The mask shaped by gamma: 1 = inside. */
fn maskValue(p: vec2u, size: vec2u) -> f32 {
  if (params.hasMask == 0u) { return 1.0; }
  return pow(clamp(maskAt(p, size), 0.0, 1.0), max(params.maskGamma, 0.01));
}

/** Pattern and amount for one pixel: inside or outside the mask. */
struct Pick { pattern: u32, amount: f32, outside: bool, diffuse: bool }

fn pick(p: vec2u, size: vec2u) -> Pick {
  let m = maskValue(p, size);
  let ms = clamp(params.maskStrength, 0.0, 1.0);
  if (params.outside != 0u && m < 0.5) {
    return Pick(params.outside - 1u, params.outsideStrength * mix(1.0, 1.0 - m, ms), true, params.diffuseOut == 1u);
  }
  return Pick(params.pattern, params.strength * mix(1.0, m, ms), false, params.diffuseIn == 1u);
}

// ── Ordered ─────────────────────────────────────────────────────────────────

/** Knoll pattern dithering: pick n candidates by accumulating error, sort by lightness, index by t. */
fn knoll(rgb: vec3f, t: f32, amount: f32) -> vec3f {
  let n = clamp(params.knollCount, 2u, 16u);
  var idx: array<u32, 16>;
  var keys: array<f32, 16>;
  var err = vec3f(0.0);
  for (var i = 0u; i < n; i++) {
    let k = nearestIndex(clamp(rgb + err * amount, vec3f(0.0), vec3f(1.0)), params.metric);
    idx[i] = k;
    keys[i] = palette[k].lab.x;
    err += rgb - paletteRgb(k);
  }
  for (var i = 1u; i < n; i++) {
    let ki = idx[i];
    let key = keys[i];
    var j = i;
    while (j > 0u && keys[j - 1u] > key) {
      idx[j] = idx[j - 1u];
      keys[j] = keys[j - 1u];
      j--;
    }
    idx[j] = ki;
    keys[j] = key;
  }
  return paletteRgb(idx[min(u32(t * f32(n)), n - 1u)]);
}

/** Ordered dithering of color c at pixel p with a pattern and amount s. */
fn ordered(c: vec4f, p: vec2u, pattern: u32, s: f32) -> vec4f {
  let t = threshold(p, pattern);
  // Per-channel thresholds: the same value (brightness only) or phase-shifted per channel (color).
  let tv = mix(vec3f(t), vec3f(t, fract(t + 0.3333333), fract(t + 0.6666667)), clamp(params.saturation, 0.0, 1.0));
  var rgb = clamp(c.rgb, vec3f(0.0), vec3f(1.0));

  if (params.mode == 1u) {
    // To levels: ordered dither between the two nearest levels.
    let n = max(params.levels - 1.0, 1.0);
    rgb = clamp(floor(rgb * n + mix(vec3f(0.5), tv, s)) / n, vec3f(0.0), vec3f(1.0));
  } else if (params.mode == 2u) {
    // Pattern only: offset by up to half a step; a later Quantize snaps.
    rgb = rgb + (tv - 0.5) * s * 0.5;
  } else if (paletteCount() > 0u) {
    if (params.mixing == 1u) {
      let pair = nearestTwo(rgb, params.metric);
      let a = rgbToOklab(paletteRgb(pair.x));
      let b = rgbToOklab(paletteRgb(pair.y));
      let d = b - a;
      let f = clamp(dot(rgbToOklab(rgb) - a, d) / max(dot(d, d), 1e-8), 0.0, 1.0);
      rgb = paletteRgb(select(pair.x, pair.y, t < f * s));
    } else if (params.mixing == 2u) {
      rgb = knoll(rgb, t, s);
    } else {
      rgb = paletteRgb(nearestIndex(clamp(rgb + (tv - 0.5) * s * 0.5, vec3f(0.0), vec3f(1.0)), params.metric));
    }
  }

  var a = c.a;
  if (params.alphaMode == 1u) { a = select(0.0, 1.0, a > 1.0 - t); }
  return vec4f(rgb, a);
}

fn run(p: vec2u, size: vec2u) -> vec4f {
  if (params.showMask == 1u) {
    let w = mix(1.0, maskValue(p, size), clamp(params.maskStrength, 0.0, 1.0));
    return vec4f(vec3f(w), 1.0);
  }
  let k = pick(p, size);
  return ordered(inputAt(p, size), p, k.pattern, k.amount);
}

// ── Error diffusion ─────────────────────────────────────────────────────────
// Parallel scan: one workgroup; thread t handles rows t, t + ROW_THREADS, … Row r processes column
// k - lag·r at step k, so every row stays at least \`lag\` (>= 3) columns behind the row above and
// all error it receives has already been written. Errors for the next row and the one after go to
// two ring buffers in \`scratch\`; each cell has exactly one writer (the row above, or two above)
// and is cleared by the row that reads it. Errors along the row itself stay in registers.
//
// Serpentine rows (every other row right to left) and wrap-around need the whole row above to be
// done first, so they run row by row on one thread. Wrap-around first runs the last rows once as a
// warm-up, so their error flows into the top rows as if the texture repeated; errors that leave a
// side re-enter on the other.

var<private> carryCur: vec3f; // error waiting for the next pixel in scan order
var<private> carryNxt: vec3f; // … and for the one after

fn snapColor(v: vec3f) -> vec3f {
  if (params.mode == 1u) {
    let n = max(params.levels - 1.0, 1.0);
    return round(v * n) / n;
  }
  if (params.mode == 0u && paletteCount() > 0u) { return paletteRgb(nearestIndex(v, params.metric)); }
  return v;
}

fn ringIndex(buffer: u32, x: u32, row: u32, width: u32, rows: u32) -> u32 {
  return (buffer * rows + row % rows) * width + x;
}

/** Adds error e to column \`col\` of \`row\` in ring buffer \`buffer\` (wrapped or dropped at the edges). */
fn addError(buffer: u32, col: i32, row: u32, size: vec2u, rows: u32, e: vec3f) {
  var c = col;
  var r = row;
  if (params.wrap == 1u) {
    c = (c % i32(size.x) + i32(size.x)) % i32(size.x);
    r = r % size.y;
  } else if (r >= size.y || c < 0 || c >= i32(size.x)) {
    return;
  }
  let j = ringIndex(buffer, u32(c), r, size.x, rows);
  scratch[j] = scratch[j] + vec4f(e, 0.0);
}

/** Spreads error e over columns x-2…x+2 (mirrored when dir < 0) of \`row\`. */
fn spread(buffer: u32, x: u32, row: u32, size: vec2u, rows: u32, e: vec3f, w: array<f32, 5>, dir: i32) {
  for (var i = 0u; i < 5u; i++) {
    if (w[i] == 0.0) { continue; }
    addError(buffer, i32(x) + (i32(i) - 2) * dir, row, size, rows, e * w[i]);
  }
}

/**
 * Dithers one pixel of an error diffusion scan in direction dir; writes it when \`write\`. Pixels
 * that get an ordered pattern (inside or outside the mask) take no part in the diffusion.
 */
fn diffusePixel(p: vec2u, size: vec2u, rows: u32, dir: i32, write: bool) {
  let c = textureLoad(src, p, 0);
  let k = pick(p, size);
  if (!k.diffuse) {
    carryCur = carryNxt;
    carryNxt = vec3f(0.0);
    scratch[ringIndex(0u, p.x, p.y, size.x, rows)] = vec4f(0.0);
    scratch[ringIndex(1u, p.x, p.y, size.x, rows)] = vec4f(0.0);
    if (write) { emit(p, size, ordered(c, p, k.pattern, k.amount)); }
    return;
  }
  let a0 = ringIndex(0u, p.x, p.y, size.x, rows);
  let a1 = ringIndex(1u, p.x, p.y, size.x, rows);
  let value = clamp(c.rgb + carryCur + scratch[a0].rgb + scratch[a1].rgb, vec3f(0.0), vec3f(1.0));
  scratch[a0] = vec4f(0.0);
  scratch[a1] = vec4f(0.0);
  let out = snapColor(value);

  var e = (value - out) * k.amount * select(0.0, 1.0, c.a > 0.0);
  let el = luma(e);
  e = vec3f(el) + (e - vec3f(el)) * clamp(params.saturation, 0.0, 1.0);
  var k0 = params.k0;
  var k1 = params.k1;
  var k2 = params.k2;
  if (k.outside) { k0 = params.o0; k1 = params.o1; k2 = params.o2; }
  carryCur = carryNxt + e * k0.x;
  carryNxt = e * k0.y;
  spread(0u, p.x, p.y + 1u, size, rows, e, array<f32, 5>(k0.z, k0.w, k1.x, k1.y, k1.z), dir);
  spread(1u, p.x, p.y + 2u, size, rows, e, array<f32, 5>(k1.w, k2.x, k2.y, k2.z, k2.w), dir);

  if (write) {
    var alpha = c.a;
    if (params.alphaMode == 1u) { alpha = select(0.0, 1.0, alpha > 1.0 - blueNoise(p)); }
    emit(p, size, vec4f(out, alpha));
  }
}

/** Rows run one after another (serpentine, wrap-around); this dispatch runs step \`stage.step\` of them. */
fn runSequential(size: vec2u, rows: u32) {
  let warm = select(0u, min(size.y, WARMUP_ROWS), params.wrap == 1u);
  let perStep = max(1u, SEQUENTIAL_STEP_PIXELS / max(size.x, 1u));
  let first = stage.step * perStep;
  for (var i = first; i < min(warm + size.y, first + perStep); i++) {
    let r = select(i - warm, size.y - warm + i, i < warm);
    let reverse = params.serpentine == 1u && (r & 1u) == 1u;
    let dir = select(1, -1, reverse);
    carryCur = vec3f(0.0);
    carryNxt = vec3f(0.0);
    for (var k = 0u; k < size.x; k++) {
      diffusePixel(vec2u(select(k, size.x - 1u - k, reverse), r), size, rows, dir, i >= warm);
    }
    if (params.wrap == 1u) {
      // Error pushed past the end of the row continues on the next row, wrapped to the other side.
      let end = i32(select(size.x - 1u, 0u, reverse));
      addError(0u, end + dir, r + 1u, size, rows, carryCur);
      addError(0u, end + 2 * dir, r + 1u, size, rows, carryNxt);
    }
  }
}

fn runRows(thread: u32, size: vec2u) {
  let rows = min(size.y, RING_ROWS);
  if (params.serpentine == 1u || params.wrap == 1u) {
    if (thread == 0u) { runSequential(size, rows); }
    return;
  }
  let lag = max(3u, (size.x + ROW_THREADS - 1u) / ROW_THREADS);
  let steps = size.x + lag * (size.y - 1u);
  for (var k = 0u; k < steps; k++) {
    let started = k / lag;
    if (started >= thread) {
      let r = thread + ROW_THREADS * ((started - thread) / ROW_THREADS);
      let x = k - lag * r;
      if (r < size.y && x < size.x) {
        if (x == 0u) { carryCur = vec3f(0.0); carryNxt = vec3f(0.0); }
        diffusePixel(vec2u(x, r), size, rows, 1, true);
      }
    }
    storageBarrier();
    workgroupBarrier();
  }
}
`,
  pack: (p) => {
    const outside = outsidePattern(p)
    return packStruct(
      ['u', index(DITHER_PATTERNS, p.pattern)],
      ['u', index(DITHER_MODES, p.mode)],
      ['u', p.metric === 'rgb' ? 1 : 0],
      ['f', p.levels],
      ['f', p.strength],
      ['u', Math.max(1, Math.round(p.scale))],
      ['u', index(DITHER_MIXING, ditherMixing(p))],
      ['u', p.alpha === 'dither' ? 1 : 0],
      ['f', p.saturation],
      ['u', ditherMask(p) ? 1 : 0],
      ['f', p.maskStrength],
      ['f', p.maskGamma],
      ['u', Math.round(p.knollCount)],
      ['u', p.showMask ? 1 : 0],
      ['u', p.serpentine ? 1 : 0],
      ['u', p.wrap ? 1 : 0],
      ['u', outside ? index(DITHER_PATTERNS, outside) + 1 : 0],
      ['f', p.outsideStrength],
      ['u', isDiffusion(p.pattern) ? 1 : 0],
      ['u', outside && isDiffusion(outside) ? 1 : 0],
      ...diffusionKernel(p.pattern).map((w): ['f', number] => ['f', w]),
      ...diffusionKernel(outside ?? p.pattern).map((w): ['f', number] => ['f', w])
    )
  },
  resources: (p) => {
    const mask = ditherMask(p)
    return {
      palette: p.mode === 'palette' ? p.paletteId : null,
      maps: mask ? maskMaps(mask) : [],
      pattern: usesPattern(p, 'custom') ? p.customPattern : undefined
    }
  },
  mask: (p) => ditherMask(p),
  ownMask: true,
  serial: (p) => {
    const outside = outsidePattern(p)
    return (isDiffusion(p.pattern) || (!!outside && isDiffusion(outside))) && p.mode !== 'pattern' && !p.showMask
  },
  serialSteps: (p, size) => {
    if (!p.serpentine && !p.wrap) return 1
    const { total, perStep } = sequentialRows(p, size)
    return Math.ceil(total / perStep)
  },
  scratchBytes: (size) => 2 * size.width * Math.min(size.height, RING_ROWS) * 16
})
