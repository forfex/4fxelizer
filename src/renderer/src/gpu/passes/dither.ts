import type { PaletteParams } from '@/stack/doc'
import { definePass, packStruct } from '../pass'
import type { ColorMetric } from './quantize'

export const DITHER_PATTERNS = [
  { id: 'bayer2', label: 'Bayer 2×2', size: 2 },
  { id: 'bayer4', label: 'Bayer 4×4', size: 4 },
  { id: 'bayer8', label: 'Bayer 8×8', size: 8 },
  { id: 'bayer16', label: 'Bayer 16×16', size: 16 },
  { id: 'blue-noise', label: 'Blue noise', size: 64 }
] as const

export type DitherPattern = (typeof DITHER_PATTERNS)[number]['id']

export const DITHER_MODES = [
  { id: 'palette', label: 'Palette', hint: 'To palette: pattern and palette snap together (classic dithering).' },
  { id: 'levels', label: 'Levels', hint: 'To levels: N levels per channel, e.g. 32 = 5-bit PSX color.' },
  { id: 'pattern', label: 'Pattern', hint: 'Pattern only: adds the pattern without snapping; a later Quantize does the snap.' }
] as const

export type DitherMode = (typeof DITHER_MODES)[number]['id']

export interface DitherParams extends PaletteParams {
  pattern: DitherPattern
  mode: DitherMode
  metric: ColorMetric
  levels: number
  /** 0 = no dithering, 1 = full. */
  strength: number
  /** Screen texels per pattern cell (1 = finest). */
  scale: number
  /** To palette: mix only between the two nearest palette colors. */
  twoNearest: boolean
  /** dither: alpha becomes 0/1 using the pattern (dithered cutout). */
  alpha: 'keep' | 'dither'
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
  alpha: 'keep'
}

/** Pattern period in texels; ordered patterns tile seamlessly when this divides the texture size. */
export function ditherPeriod(p: DitherParams): number {
  return (DITHER_PATTERNS.find((d) => d.id === p.pattern)?.size ?? 1) * Math.max(1, Math.round(p.scale))
}

export const dither = definePass<DitherParams>({
  id: 'dither',
  label: 'Dither',
  wgsl: /* wgsl */ `
struct Params {
  pattern: u32, mode: u32, metric: u32, levels: f32,
  strength: f32, scale: u32, twoNearest: u32, alphaMode: u32,
}

fn threshold(p: vec2u) -> f32 {
  let q = p / max(params.scale, 1u);
  switch params.pattern {
    case 0u: { return bayer(q, 2u); }
    case 1u: { return bayer(q, 4u); }
    case 2u: { return bayer(q, 8u); }
    case 3u: { return bayer(q, 16u); }
    default: { return blueNoise(q); }
  }
}

fn run(p: vec2u, size: vec2u) -> vec4f {
  let c = inputAt(p, size);
  let t = threshold(p);
  let s = params.strength;
  var rgb = clamp(c.rgb, vec3f(0.0), vec3f(1.0));

  if (params.mode == 1u) {
    // To levels: ordered dither between the two nearest levels.
    let n = max(params.levels - 1.0, 1.0);
    rgb = clamp(floor(rgb * n + mix(0.5, t, s)) / n, vec3f(0.0), vec3f(1.0));
  } else if (params.mode == 2u) {
    // Pattern only: offset by up to half a step; a later Quantize snaps.
    rgb = rgb + (t - 0.5) * s * 0.5;
  } else if (paletteCount() > 0u) {
    if (params.twoNearest == 1u) {
      let pair = nearestTwo(rgb, params.metric);
      let a = rgbToOklab(paletteRgb(pair.x));
      let b = rgbToOklab(paletteRgb(pair.y));
      let d = b - a;
      let f = clamp(dot(rgbToOklab(rgb) - a, d) / max(dot(d, d), 1e-8), 0.0, 1.0);
      rgb = paletteRgb(select(pair.x, pair.y, t < f * s));
    } else {
      rgb = paletteRgb(nearestIndex(clamp(rgb + (t - 0.5) * s * 0.5, vec3f(0.0), vec3f(1.0)), params.metric));
    }
  }

  var a = c.a;
  if (params.alphaMode == 1u) { a = select(0.0, 1.0, a > 1.0 - t); }
  return vec4f(rgb, a);
}
`,
  pack: (p) =>
    packStruct(
      ['u', Math.max(0, DITHER_PATTERNS.findIndex((d) => d.id === p.pattern))],
      ['u', Math.max(0, DITHER_MODES.findIndex((m) => m.id === p.mode))],
      ['u', p.metric === 'rgb' ? 1 : 0],
      ['f', p.levels],
      ['f', p.strength],
      ['u', Math.max(1, Math.round(p.scale))],
      ['u', p.twoNearest ? 1 : 0],
      ['u', p.alpha === 'dither' ? 1 : 0]
    ),
  resources: (p) => ({ palette: p.mode === 'palette' ? p.paletteId : null })
})
