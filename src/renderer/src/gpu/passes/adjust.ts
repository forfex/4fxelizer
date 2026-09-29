import { maskMaps, type MaskSpec } from '../mask'
import { definePass, packStruct } from '../pass'

export interface AdjustParams {
  /** Unsharp-mask amount applied first (0 = off). */
  sharpen: number
  /** Input levels: values at or below inBlack become black, at or above inWhite become white. */
  inBlack: number
  inWhite: number
  /** Midtone gamma (1 = unchanged, > 1 brightens). */
  gamma: number
  brightness: number
  contrast: number
  /** -1 = grayscale, 0 = unchanged, 1 = double chroma. */
  saturation: number
  /** Hue rotation in degrees. */
  hue: number
  /** Output levels. */
  outBlack: number
  outWhite: number
  /** How strongly the imported AO map darkens the color (baked-lighting look; 0 = off). */
  ao: number
  /** How strongly the imported cavity map darkens the color (0 = off). */
  cavity: number
}

export const DEFAULT_ADJUST: AdjustParams = {
  sharpen: 0,
  inBlack: 0,
  inWhite: 1,
  gamma: 1,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  hue: 0,
  outBlack: 0,
  outWhite: 1,
  ao: 0,
  cavity: 0
}

/**
 * The shading the AO and cavity maps multiply into the color, built like a mask (maps sampled in
 * UV, so it lines up at any size), or null when neither is used.
 */
export function adjustShading(p: AdjustParams): MaskSpec | null {
  const sources = [
    { source: 'map-ao' as const, amount: p.ao },
    { source: 'map-cavity' as const, amount: p.cavity }
  ].filter((s) => s.amount > 0)
  if (!sources.length) return null
  const [a, b] = sources
  return { a: a!.source, aInvert: false, aAmount: a!.amount, b: b?.source ?? 'none', bInvert: false, bAmount: b?.amount, combine: 'multiply', blur: 0, wrap: false }
}

/** Color adjustments before reduction: sharpen → AO/cavity shading → input levels → gamma → brightness/contrast → hue/saturation → output levels. */
export const adjust = definePass<AdjustParams>({
  id: 'adjust',
  label: 'Adjust',
  wgsl: /* wgsl */ `
struct Params {
  sharpen: f32, inBlack: f32, inWhite: f32, gamma: f32,
  brightness: f32, contrast: f32, saturation: f32, hue: f32,
  outBlack: f32, outWhite: f32, shade: u32, _p1: f32,
}

fn load(p: vec2i) -> vec4f {
  let dims = vec2i(textureDimensions(src));
  return textureLoad(src, clamp(p, vec2i(0), dims - 1), 0);
}

fn run(p: vec2u, size: vec2u) -> vec4f {
  let q = vec2i(p);
  let c0 = load(q);
  var c = c0.rgb;

  if (params.sharpen > 0.0) {
    var blur = vec3f(0.0);
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let w = select(select(1.0, 2.0, dx == 0 || dy == 0), 4.0, dx == 0 && dy == 0);
        blur += load(q + vec2i(dx, dy)).rgb * w;
      }
    }
    c = c + (c - blur / 16.0) * params.sharpen;
  }

  // Baked lighting: the AO/cavity shading is built as this stage's mask (see adjustShading).
  if (params.shade == 1u) { c = c * maskAt(p, size); }

  c = clamp((c - params.inBlack) / max(params.inWhite - params.inBlack, 1e-4), vec3f(0.0), vec3f(1.0));
  c = pow(c, vec3f(1.0 / max(params.gamma, 0.01)));
  c = c + params.brightness;
  let k = select(1.0 + params.contrast, 1.0 / max(1.0 - params.contrast, 0.02), params.contrast > 0.0);
  c = (c - 0.5) * k + 0.5;

  if (params.saturation != 0.0 || params.hue != 0.0) {
    let lab = rgbToOklab(clamp(c, vec3f(0.0), vec3f(1.0)));
    let a = radians(params.hue);
    let ab = vec2f(lab.y * cos(a) - lab.z * sin(a), lab.y * sin(a) + lab.z * cos(a)) * (1.0 + params.saturation);
    c = oklabToRgb(vec3f(lab.x, ab));
  }

  c = mix(vec3f(params.outBlack), vec3f(params.outWhite), clamp(c, vec3f(0.0), vec3f(1.0)));
  return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), c0.a);
}
`,
  pack: (p) =>
    packStruct(
      ['f', p.sharpen], ['f', p.inBlack], ['f', p.inWhite], ['f', p.gamma],
      ['f', p.brightness], ['f', p.contrast], ['f', p.saturation], ['f', p.hue],
      ['f', p.outBlack], ['f', p.outWhite], ['u', adjustShading(p) ? 1 : 0], ['f', 0]
    ),
  mask: adjustShading,
  resources: (p) => {
    const shading = adjustShading(p)
    return shading ? { maps: maskMaps(shading) } : {}
  }
})
