import type { PaletteParams } from '@/stack/doc'
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
  { id: 'n64-magic', label: 'N64 magic square', kind: 'ordered', period: 4 }
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

/** Where the dither is applied (the rest of the image gets less of it). */
export const DITHER_MASKS = [
  { id: 'none', label: 'Everywhere', hint: 'Dither the whole image evenly.' },
  { id: 'edges', label: 'Edges', hint: 'Dither mostly along edges and detail.' },
  { id: 'flats', label: 'Flats', hint: 'Dither mostly in smooth, flat areas (gradients), keep edges clean.' },
  { id: 'shadows', label: 'Shadows', hint: 'Dither mostly in dark areas.' },
  { id: 'midtones', label: 'Midtones', hint: 'Dither mostly in mid-brightness areas.' },
  { id: 'highlights', label: 'Highlights', hint: 'Dither mostly in bright areas.' },
  { id: 'saturated', label: 'Saturated', hint: 'Dither mostly in colorful areas.' },
  { id: 'grays', label: 'Grays', hint: 'Dither mostly in gray, desaturated areas.' }
] as const

export type DitherMask = (typeof DITHER_MASKS)[number]['id']

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
  /** 0 = mask ignored, 1 = dither fully follows the mask. */
  maskStrength: number
  /** Shapes the mask: < 1 widens it, > 1 narrows it. */
  maskGamma: number
  /** dither: alpha becomes 0/1 using the pattern (dithered cutout). */
  alpha: 'keep' | 'dither'
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
  maskStrength: 1,
  maskGamma: 1,
  alpha: 'keep'
}

export function isDiffusion(pattern: DitherPattern): boolean {
  return DITHER_PATTERNS.find((d) => d.id === pattern)?.kind === 'diffusion'
}

/** Effective mixing, honoring the legacy `twoNearest` switch. */
export function ditherMixing(p: DitherParams): DitherMixing {
  return p.mixing === 'offset' && p.twoNearest ? 'two-nearest' : p.mixing
}

/**
 * Pattern period in texels; ordered patterns tile seamlessly when this divides the texture size.
 * 0 = the pattern never repeats (noise, error diffusion).
 */
export function ditherPeriod(p: DitherParams): number {
  const period = DITHER_PATTERNS.find((d) => d.id === p.pattern)?.period ?? 0
  return period * (isDiffusion(p.pattern) ? 1 : Math.max(1, Math.round(p.scale)))
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

const index = <T extends { id: string }>(list: readonly T[], id: string): number =>
  Math.max(0, list.findIndex((d) => d.id === id))

export const dither = definePass<DitherParams>({
  id: 'dither',
  label: 'Dither',
  wgsl: /* wgsl */ `
struct Params {
  pattern: u32, mode: u32, metric: u32, levels: f32,
  strength: f32, scale: u32, mixing: u32, alphaMode: u32,
  saturation: f32, mask: u32, maskStrength: f32, maskGamma: f32,
  knollCount: u32, showMask: u32, _pad0: u32, _pad1: u32,
  k0: vec4f, k1: vec4f, k2: vec4f,
}

const RING_ROWS = ${RING_ROWS}u;
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

/** Rank of the cell within its n×n tile by spot value, as an evenly distributed threshold. */
fn rankThreshold(p: vec2u, kind: u32, n: u32) -> f32 {
  let q = p % n;
  let v = spotValue(kind, q, n);
  let qi = q.y * n + q.x;
  var rank = 0u;
  for (var j = 0u; j < n * n; j++) {
    let o = spotValue(kind, vec2u(j % n, j / n), n);
    if (o < v || (o == v && j < qi)) { rank++; }
  }
  return (f32(rank) + 0.5) / f32(n * n);
}

fn threshold(p: vec2u) -> f32 {
  let q = p / max(params.scale, 1u);
  switch params.pattern {
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
    default: { return blueNoise(q); }
  }
}

// ── Mask ────────────────────────────────────────────────────────────────────

fn lightAt(p: vec2i, size: vec2u) -> f32 {
  let q = clamp(p, vec2i(0), vec2i(size) - 1);
  return rgbToOklab(textureLoad(src, vec2u(q), 0).rgb).x;
}

/** 0..1: how much this pixel belongs to the mask. */
fn maskValue(p: vec2u, size: vec2u) -> f32 {
  if (params.mask == 1u || params.mask == 2u) {
    let c = vec2i(p);
    let tl = lightAt(c + vec2i(-1, -1), size);
    let t = lightAt(c + vec2i(0, -1), size);
    let tr = lightAt(c + vec2i(1, -1), size);
    let l = lightAt(c + vec2i(-1, 0), size);
    let r = lightAt(c + vec2i(1, 0), size);
    let bl = lightAt(c + vec2i(-1, 1), size);
    let b = lightAt(c + vec2i(0, 1), size);
    let br = lightAt(c + vec2i(1, 1), size);
    let gx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
    let gy = (bl + 2.0 * b + br) - (tl + 2.0 * t + tr);
    let edge = clamp(length(vec2f(gx, gy)), 0.0, 1.0);
    return select(1.0 - edge, edge, params.mask == 1u);
  }
  let lab = rgbToOklab(textureLoad(src, p, 0).rgb);
  let chroma = clamp(length(lab.yz) / 0.2, 0.0, 1.0);
  switch params.mask {
    case 3u: { return 1.0 - lab.x; }
    case 4u: { return 1.0 - abs(2.0 * lab.x - 1.0); }
    case 5u: { return lab.x; }
    case 6u: { return chroma; }
    case 7u: { return 1.0 - chroma; }
    default: { return 1.0; }
  }
}

/** Dither amount multiplier from the mask (1 = unmasked). */
fn maskWeight(p: vec2u, size: vec2u) -> f32 {
  if (params.mask == 0u) { return 1.0; }
  let m = pow(clamp(maskValue(p, size), 0.0, 1.0), max(params.maskGamma, 0.01));
  return mix(1.0, m, clamp(params.maskStrength, 0.0, 1.0));
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

fn run(p: vec2u, size: vec2u) -> vec4f {
  let c = inputAt(p, size);
  let w = maskWeight(p, size);
  if (params.showMask == 1u) { return vec4f(vec3f(w), 1.0); }
  let t = threshold(p);
  let s = params.strength * w;
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

// ── Error diffusion ─────────────────────────────────────────────────────────
// One workgroup; thread t handles rows t, t + ROW_THREADS, … Row r processes column k - lag·r at
// step k, so every row stays at least \`lag\` (>= 3) columns behind the row above and all error it
// receives has already been written. Errors for the next row and the one after go to two ring
// buffers in \`scratch\`; each cell has exactly one writer (the row above, or two above) and is
// cleared by the row that reads it. Errors along the row itself stay in registers.

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

/** Adds error e with weights for columns x-2…x+2 of \`row\` into ring buffer \`buffer\`. */
fn spread(buffer: u32, x: u32, row: u32, size: vec2u, rows: u32, e: vec3f, w: array<f32, 5>) {
  if (row >= size.y) { return; }
  for (var i = 0u; i < 5u; i++) {
    let col = i32(x) + i32(i) - 2;
    if (w[i] == 0.0 || col < 0 || col >= i32(size.x)) { continue; }
    let j = ringIndex(buffer, u32(col), row, size.x, rows);
    scratch[j] = scratch[j] + vec4f(e * w[i], 0.0);
  }
}

fn runRows(thread: u32, size: vec2u) {
  let lag = max(3u, (size.x + ROW_THREADS - 1u) / ROW_THREADS);
  let rows = min(size.y, RING_ROWS);
  let steps = size.x + lag * (size.y - 1u);
  var cur = vec3f(0.0); // error waiting for the current column
  var nxt = vec3f(0.0); // … and for the next one
  for (var k = 0u; k < steps; k++) {
    let started = k / lag;
    if (started >= thread) {
      let r = thread + ROW_THREADS * ((started - thread) / ROW_THREADS);
      let x = k - lag * r;
      if (r < size.y && x < size.x) {
        if (x == 0u) { cur = vec3f(0.0); nxt = vec3f(0.0); }
        let p = vec2u(x, r);
        let c = textureLoad(src, p, 0);
        let a0 = ringIndex(0u, x, r, size.x, rows);
        let a1 = ringIndex(1u, x, r, size.x, rows);
        let value = clamp(c.rgb + cur + scratch[a0].rgb + scratch[a1].rgb, vec3f(0.0), vec3f(1.0));
        scratch[a0] = vec4f(0.0);
        scratch[a1] = vec4f(0.0);
        let out = snapColor(value);

        var e = (value - out) * params.strength * maskWeight(p, size) * select(0.0, 1.0, c.a > 0.0);
        let el = luma(e);
        e = vec3f(el) + (e - vec3f(el)) * clamp(params.saturation, 0.0, 1.0);
        cur = nxt + e * params.k0.x;
        nxt = e * params.k0.y;
        spread(0u, x, r + 1u, size, rows, e, array<f32, 5>(params.k0.z, params.k0.w, params.k1.x, params.k1.y, params.k1.z));
        spread(1u, x, r + 2u, size, rows, e, array<f32, 5>(params.k1.w, params.k2.x, params.k2.y, params.k2.z, params.k2.w));

        var alpha = c.a;
        if (params.alphaMode == 1u) { alpha = select(0.0, 1.0, alpha > 1.0 - blueNoise(p)); }
        emit(p, size, vec4f(out, alpha));
      }
    }
    storageBarrier();
    workgroupBarrier();
  }
}
`,
  pack: (p) => {
    const k = diffusionKernel(p.pattern)
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
      ['u', index(DITHER_MASKS, p.mask)],
      ['f', p.maskStrength],
      ['f', p.maskGamma],
      ['u', Math.round(p.knollCount)],
      ['u', p.showMask ? 1 : 0],
      ['u', 0],
      ['u', 0],
      ...k.map((w): ['f', number] => ['f', w])
    )
  },
  resources: (p) => ({ palette: p.mode === 'palette' ? p.paletteId : null }),
  serial: (p) => isDiffusion(p.pattern) && p.mode !== 'pattern' && !p.showMask,
  scratchBytes: (size) => 2 * size.width * Math.min(size.height, RING_ROWS) * 16
})
