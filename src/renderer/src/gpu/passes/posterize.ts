import { definePass } from '../pass'

export interface PosterizeParams {
  /** Levels per channel, >= 2. */
  levels: number
}

/**
 * Phase 0 test pass: proves the chain end to end (upload → compute → cache → view → export).
 * The real Quantize/Dither stages replace it in Phase 1.
 */
export const posterize = definePass<PosterizeParams>({
  id: 'posterize',
  label: 'Posterize (test)',
  wgsl: /* wgsl */ `
struct Params { levels: f32, _p0: f32, _p1: f32, _p2: f32 }

fn run(p: vec2u, size: vec2u) -> vec4f {
  let c = textureLoad(src, p, 0);
  let n = max(params.levels - 1.0, 1.0);
  return vec4f(round(c.rgb * n) / n, c.a);
}
`,
  pack: (p) => new Float32Array([p.levels, 0, 0, 0])
})

/** CPU reference, used by the GPU smoke test. */
export function posterizeCpu(value: number, levels: number): number {
  const n = Math.max(levels - 1, 1)
  return Math.round(Math.round((value / 255) * n) / n * 255)
}
