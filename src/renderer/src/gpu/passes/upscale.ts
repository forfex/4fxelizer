import { definePass, packStruct, type Size } from '../pass'
import { MAX_DOWNSCALE_SIDE } from './downscale'

export const UPSCALE_METHODS = [
  { id: 'nearest', label: 'Nearest', hint: 'Blocky, every texel stays a hard square.' },
  { id: 'n64', label: 'N64 3-point', hint: 'The Nintendo 64 texture filter: blends 3 texels, soft with slightly jagged diagonals.' },
  { id: 'bilinear', label: 'Bilinear', hint: 'Blends the 4 nearest texels. Smooth, like most PC hardware.' },
  { id: 'bicubic', label: 'Bicubic', hint: 'Smoother and a little sharper than bilinear (Catmull-Rom).' }
] as const

export type UpscaleMethod = (typeof UPSCALE_METHODS)[number]['id']

export interface UpscaleParams {
  method: UpscaleMethod
  /** factor: input × factor; source: back to the original image size. */
  sizeMode: 'factor' | 'source'
  factor: number
  /** Wrap around the edges (tiling textures) instead of clamping. */
  wrap: boolean
}

export const DEFAULT_UPSCALE: UpscaleParams = {
  method: 'n64',
  sizeMode: 'factor',
  factor: 4,
  wrap: false
}

export const MAX_UPSCALE_FACTOR = 16

export function upscaleSize(input: Size, p: UpscaleParams, source: Size | null): Size {
  const fix = (v: number): number => Math.min(Math.max(1, Math.round(v)), MAX_DOWNSCALE_SIDE)
  if (p.sizeMode === 'source' && source) return { width: fix(source.width), height: fix(source.height) }
  const k = Math.min(Math.max(Math.round(p.factor), 1), MAX_UPSCALE_FACTOR)
  return { width: fix(input.width * k), height: fix(input.height * k) }
}

export const upscale = definePass<UpscaleParams>({
  id: 'upscale',
  label: 'Upscale',
  wgsl: /* wgsl */ `
struct Params { method: u32, wrap: u32, _pad0: u32, _pad1: u32 }

fn texel(q: vec2i) -> vec4f {
  let n = vec2i(textureDimensions(src));
  var c = q;
  if (params.wrap == 1u) { c = ((q % n) + n) % n; } else { c = clamp(q, vec2i(0), n - 1); }
  return textureLoad(src, vec2u(c), 0);
}

// Filtering weights by alpha (premultiplied), so transparent texels don't bleed their color.
fn premul(c: vec4f) -> vec4f { return vec4f(c.rgb * c.a, c.a); }
fn unpremul(c: vec4f) -> vec4f {
  let a = clamp(c.a, 0.0, 1.0);
  if (a <= 0.0) { return vec4f(0.0); }
  return vec4f(clamp(c.rgb / c.a, vec3f(0.0), vec3f(1.0)), a);
}

fn catmullRom(t: f32) -> vec4f {
  let t2 = t * t;
  let t3 = t2 * t;
  return vec4f(
    -0.5 * t3 + t2 - 0.5 * t,
    1.5 * t3 - 2.5 * t2 + 1.0,
    -1.5 * t3 + 2.0 * t2 + 0.5 * t,
    0.5 * t3 - 0.5 * t2);
}

fn run(p: vec2u, size: vec2u) -> vec4f {
  let srcSize = vec2f(textureDimensions(src));
  // Source-space position of this output texel's center, relative to texel centers.
  let pos = (vec2f(p) + 0.5) * srcSize / vec2f(size) - 0.5;
  let base = vec2i(floor(pos));
  let f = pos - floor(pos);

  if (params.method == 0u) {
    return texel(vec2i(floor((vec2f(p) + 0.5) * srcSize / vec2f(size))));
  }
  let c00 = premul(texel(base));
  let c10 = premul(texel(base + vec2i(1, 0)));
  let c01 = premul(texel(base + vec2i(0, 1)));
  let c11 = premul(texel(base + vec2i(1, 1)));
  if (params.method == 1u) {
    // N64 3-point: interpolate across the triangle of the quad that contains the sample.
    if (f.x + f.y <= 1.0) {
      return unpremul(c00 + f.x * (c10 - c00) + f.y * (c01 - c00));
    }
    return unpremul(c11 + (1.0 - f.x) * (c01 - c11) + (1.0 - f.y) * (c10 - c11));
  }
  if (params.method == 2u) {
    return unpremul(mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y));
  }
  let wx = catmullRom(f.x);
  let wy = catmullRom(f.y);
  var acc = vec4f(0.0);
  for (var j = 0; j < 4; j++) {
    var row = vec4f(0.0);
    for (var i = 0; i < 4; i++) {
      row += wx[i] * premul(texel(base + vec2i(i - 1, j - 1)));
    }
    acc += wy[j] * row;
  }
  return unpremul(acc);
}
`,
  pack: (p) =>
    packStruct(['u', Math.max(0, UPSCALE_METHODS.findIndex((m) => m.id === p.method))], ['u', p.wrap ? 1 : 0], ['u', 0], ['u', 0]),
  outputSize: (input, p, ctx) => upscaleSize(input, p, ctx?.source ?? null)
})
