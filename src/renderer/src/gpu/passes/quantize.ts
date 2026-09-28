import { definePass, packStruct } from '../pass'

export type ColorMetric = 'oklab' | 'rgb'

export interface QuantizeParams {
  /** palette: snap to the nearest palette color; levels: N evenly spaced levels per channel. */
  mode: 'palette' | 'levels'
  paletteId: string | null
  /** Levels per channel (32 = 5-bit, PSX 15-bit color). */
  levels: number
  metric: ColorMetric
  /** binary: alpha becomes 0 or 1 at the threshold (cutout, PSX-style). */
  alpha: 'keep' | 'binary'
  alphaThreshold: number
}

export const DEFAULT_QUANTIZE: QuantizeParams = {
  mode: 'palette',
  paletteId: null,
  levels: 32,
  metric: 'oklab',
  alpha: 'keep',
  alphaThreshold: 0.5
}

export const quantize = definePass<QuantizeParams>({
  id: 'quantize',
  label: 'Quantize',
  wgsl: /* wgsl */ `
struct Params { mode: u32, levels: f32, metric: u32, alphaMode: u32, alphaThreshold: f32, _p0: f32, _p1: f32, _p2: f32 }

fn run(p: vec2u, size: vec2u) -> vec4f {
  let c = inputAt(p, size);
  var rgb = c.rgb;
  if (params.mode == 1u) {
    let n = max(params.levels - 1.0, 1.0);
    rgb = round(clamp(rgb, vec3f(0.0), vec3f(1.0)) * n) / n;
  } else if (paletteCount() > 0u) {
    rgb = paletteRgb(nearestIndex(rgb, params.metric));
  }
  var a = c.a;
  if (params.alphaMode == 1u) { a = select(0.0, 1.0, a >= params.alphaThreshold); }
  return vec4f(rgb, a);
}
`,
  pack: (p) =>
    packStruct(
      ['u', p.mode === 'levels' ? 1 : 0],
      ['f', p.levels],
      ['u', p.metric === 'rgb' ? 1 : 0],
      ['u', p.alpha === 'binary' ? 1 : 0],
      ['f', p.alphaThreshold],
      ['f', 0], ['f', 0], ['f', 0]
    ),
  resources: (p) => ({ palette: p.mode === 'palette' ? p.paletteId : null })
})

/** CPU reference for levels mode on 8-bit values (used by the GPU smoke test). */
export function quantizeLevelsCpu(value: number, levels: number): number {
  const n = Math.max(levels - 1, 1)
  return Math.round((Math.round((value / 255) * n) / n) * 255)
}
