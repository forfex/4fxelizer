import { definePass, packStruct, type Size } from '../pass'
import { MAX_DOWNSCALE_SIDE } from './downscale'

export const UPSCALE_METHODS = [
  { id: 'nearest', label: 'Nearest', hint: 'Blocky, every texel stays a hard square.' },
  { id: 'n64', label: 'N64 3-point', hint: 'The Nintendo 64 texture filter: blends 3 texels, soft with slightly jagged diagonals.' },
  { id: 'bilinear', label: 'Bilinear', hint: 'Blends the 4 nearest texels. Smooth, like most PC hardware.' },
  { id: 'bicubic', label: 'Bicubic', hint: 'Smoother and a little sharper than bilinear (Catmull-Rom).' },
  { id: 'sharp-bilinear', label: 'Sharp bilinear', hint: 'Crisp pixels with only their edges softened, like emulator "sharp" shaders. Differs from Nearest at non-integer sizes (e.g. Original).' },
  { id: 'lanczos', label: 'Lanczos', hint: 'Sharpest smooth filter (Lanczos-3); may ring around hard edges.' },
  { id: 'epx', label: 'Scale2x / Scale3x (EPX)', hint: 'Pixel-art upscaler: rounds off jagged diagonals without blurring or adding colors.' }
] as const

export type UpscaleMethod = (typeof UPSCALE_METHODS)[number]['id']

/** How alpha is enlarged; a position is its shader index. */
export const UPSCALE_ALPHA = [
  { id: 'same', label: 'Same as color', hint: 'Alpha is filtered with the color.' },
  { id: 'nearest', label: 'Nearest', hint: 'Hard, blocky edges.' },
  { id: 'smooth', label: 'Smooth', hint: 'Bilinear: soft edges.' },
  { id: 'cutout', label: 'Cutout', hint: 'Smooth alpha cut at a threshold: hard edges that follow curves (alpha test).' },
  { id: 'source', label: 'Original image', hint: 'The alpha of the loaded image, 1:1 when Size is Original: crisp full-resolution edges.' }
] as const

export type UpscaleAlpha = (typeof UPSCALE_ALPHA)[number]['id']

export interface UpscaleParams {
  method: UpscaleMethod
  /** factor: input × factor; source: back to the original image size. */
  sizeMode: 'factor' | 'source'
  factor: number
  /** Wrap around the edges (tiling textures) instead of clamping. */
  wrap: boolean
  /** Alpha filter, separate from the color filter. */
  alpha: UpscaleAlpha
  /** Cutout: the alpha from which a texel is opaque. */
  alphaThreshold: number
}

export const DEFAULT_UPSCALE: UpscaleParams = {
  method: 'n64',
  sizeMode: 'factor',
  factor: 4,
  wrap: false,
  alpha: 'same',
  alphaThreshold: 0.5
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
struct Params { method: u32, wrap: u32, alphaMode: u32, alphaThreshold: f32 }

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

fn bilinearAt(pos: vec2f) -> vec4f {
  let base = vec2i(floor(pos));
  let f = pos - floor(pos);
  let c00 = premul(texel(base));
  let c10 = premul(texel(base + vec2i(1, 0)));
  let c01 = premul(texel(base + vec2i(0, 1)));
  let c11 = premul(texel(base + vec2i(1, 1)));
  return unpremul(mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y));
}

fn sinc(x: f32) -> f32 {
  if (abs(x) < 1e-5) { return 1.0; }
  let a = 3.14159265 * x;
  return sin(a) / a;
}

fn lanczos3(x: f32) -> f32 {
  if (abs(x) >= 3.0) { return 0.0; }
  return sinc(x) * sinc(x / 3.0);
}

// ── EPX / Scale2x / Scale3x ──────────────────────────────────────────────────
// Exact color comparisons on the input texels; outputs only colors that are already there.

fn same(a: vec4f, b: vec4f) -> bool { return all(a == b); }

fn floorDiv(a: vec2i, b: i32) -> vec2i {
  return vec2i(floor(vec2f(a) / f32(b)));
}

/** Scale2x rule: sub-pixel q (0/1, 0/1) of center e with neighbors up a, right b, left c, down d. */
fn scale2xPick(e: vec4f, a: vec4f, b: vec4f, c: vec4f, d: vec4f, q: vec2i) -> vec4f {
  if (q.x == 0 && q.y == 0) { if (same(c, a) && !same(c, d) && !same(a, b)) { return a; } }
  else if (q.x == 1 && q.y == 0) { if (same(a, b) && !same(a, c) && !same(b, d)) { return b; } }
  else if (q.x == 0 && q.y == 1) { if (same(d, c) && !same(d, b) && !same(c, a)) { return c; } }
  else { if (same(b, d) && !same(b, a) && !same(d, c)) { return d; } }
  return e;
}

/** One Scale2x level: the texel at c of the 2× image. */
fn scale2x(c: vec2i) -> vec4f {
  let s = floorDiv(c, 2);
  return scale2xPick(texel(s), texel(s + vec2i(0, -1)), texel(s + vec2i(1, 0)), texel(s + vec2i(-1, 0)), texel(s + vec2i(0, 1)), c - s * 2);
}

/** Two Scale2x levels: the texel at c of the 4× image. */
fn scale4x(c: vec2i) -> vec4f {
  let s = floorDiv(c, 2);
  return scale2xPick(scale2x(s), scale2x(s + vec2i(0, -1)), scale2x(s + vec2i(1, 0)), scale2x(s + vec2i(-1, 0)), scale2x(s + vec2i(0, 1)), c - s * 2);
}

/** Scale3x: the texel at c of the 3× image. */
fn scale3x(c: vec2i) -> vec4f {
  let s = floorDiv(c, 3);
  let q = c - s * 3;
  let A = texel(s + vec2i(-1, -1)); let B = texel(s + vec2i(0, -1)); let C = texel(s + vec2i(1, -1));
  let D = texel(s + vec2i(-1, 0));  let E = texel(s);                let F = texel(s + vec2i(1, 0));
  let G = texel(s + vec2i(-1, 1));  let H = texel(s + vec2i(0, 1));  let I = texel(s + vec2i(1, 1));
  let db = same(D, B) && !same(B, F) && !same(D, H);
  let bf = same(B, F) && !same(B, D) && !same(F, H);
  let dh = same(D, H) && !same(D, F) && !same(H, B);
  let hf = same(H, F) && !same(D, F) && !same(B, H);
  let i = q.y * 3 + q.x;
  switch i {
    case 0: { if (db) { return D; } }
    case 1: { if ((db && !same(E, C)) || (bf && !same(E, A))) { return B; } }
    case 2: { if (bf) { return F; } }
    case 3: { if ((db && !same(E, G)) || (dh && !same(E, A))) { return D; } }
    case 5: { if ((bf && !same(E, I)) || (hf && !same(E, C))) { return F; } }
    case 6: { if (dh) { return D; } }
    case 7: { if ((dh && !same(E, I)) || (hf && !same(E, G))) { return H; } }
    case 8: { if (hf) { return F; } }
    default: {}
  }
  return E;
}

fn epx(p: vec2u, size: vec2u, srcSize: vec2f) -> vec4f {
  let k = f32(size.x) / srcSize.x;
  // Pick the pattern that best fits the factor, then enlarge that result with nearest.
  var m = 2;
  if (abs(k - 3.0) < 0.01 || abs(k - 6.0) < 0.01) { m = 3; } else if (k >= 3.99) { m = 4; }
  let c = vec2i(floor((vec2f(p) + 0.5) * f32(m) * srcSize / vec2f(size)));
  if (m == 3) { return scale3x(c); }
  if (m == 4) { return scale4x(c); }
  return scale2x(c);
}

fn colorAt(p: vec2u, size: vec2u) -> vec4f {
  let srcSize = vec2f(textureDimensions(src));
  // Source-space position of this output texel's center, relative to texel centers.
  let pos = (vec2f(p) + 0.5) * srcSize / vec2f(size) - 0.5;
  let base = vec2i(floor(pos));
  let f = pos - floor(pos);

  if (params.method == 0u) {
    return texel(vec2i(floor((vec2f(p) + 0.5) * srcSize / vec2f(size))));
  }
  if (params.method == 4u) {
    // Sharp bilinear: stay on the texel center, blend only within ~1 output pixel of its edges.
    let scale = vec2f(size) / srcSize;
    let t = (vec2f(p) + 0.5) * srcSize / vec2f(size);
    let d = fract(t) - 0.5;
    let region = max(0.5 - 0.5 / scale, vec2f(0.0));
    let offset = (d - clamp(d, -region, region)) * scale + 0.5;
    return bilinearAt(floor(t) + offset - 0.5);
  }
  if (params.method == 5u) {
    var acc = vec4f(0.0);
    var total = 0.0;
    for (var j = -2; j <= 3; j++) {
      for (var i = -2; i <= 3; i++) {
        let w = lanczos3(f.x - f32(i)) * lanczos3(f.y - f32(j));
        acc += w * premul(texel(base + vec2i(i, j)));
        total += w;
      }
    }
    return unpremul(acc / total);
  }
  if (params.method == 6u) { return epx(p, size, srcSize); }
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

/** The loaded image's alpha: exact at its own size, filtered to fit at any other. */
fn sourceAlpha(p: vec2u, size: vec2u) -> f32 {
  if (all(textureDimensions(sourceTex) == size)) { return textureLoad(sourceTex, p, 0).a; }
  return textureSampleLevel(sourceTex, linearSampler, (vec2f(p) + 0.5) / vec2f(size), 0.0).a;
}

/** Color of the visible texels around q, for texels the color filter left transparent. */
fn nearbyColor(q: vec2i, fallback: vec3f) -> vec3f {
  var acc = vec4f(0.0);
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) { acc += premul(texel(q + vec2i(i, j))); }
  }
  if (acc.a <= 1.0 / 512.0) { return fallback; }
  return clamp(acc.rgb / acc.a, vec3f(0.0), vec3f(1.0));
}

fn run(p: vec2u, size: vec2u) -> vec4f {
  let c = colorAt(p, size);
  if (params.alphaMode == 0u) { return c; }
  let srcSize = vec2f(textureDimensions(src));
  let q = vec2i(floor((vec2f(p) + 0.5) * srcSize / vec2f(size)));
  var a = 0.0;
  if (params.alphaMode == 1u) {
    a = texel(q).a;
  } else if (params.alphaMode == 4u) {
    a = sourceAlpha(p, size);
  } else {
    let pos = (vec2f(p) + 0.5) * srcSize / vec2f(size) - 0.5;
    let base = vec2i(floor(pos));
    let f = pos - floor(pos);
    a = mix(mix(texel(base).a, texel(base + vec2i(1, 0)).a, f.x), mix(texel(base + vec2i(0, 1)).a, texel(base + vec2i(1, 1)).a, f.x), f.y);
    if (params.alphaMode == 3u) { a = select(0.0, 1.0, a >= max(params.alphaThreshold, 1.0 / 512.0)); }
  }
  var rgb = c.rgb;
  if (c.a <= 1.0 / 512.0 && a > 0.0) { rgb = nearbyColor(q, rgb); }
  return vec4f(rgb, clamp(a, 0.0, 1.0));
}
`,
  pack: (p) =>
    packStruct(
      ['u', Math.max(0, UPSCALE_METHODS.findIndex((m) => m.id === p.method))],
      ['u', p.wrap ? 1 : 0],
      ['u', Math.max(0, UPSCALE_ALPHA.findIndex((m) => m.id === p.alpha))],
      ['f', p.alphaThreshold]
    ),
  outputSize: (input, p, ctx) => upscaleSize(input, p, ctx?.source ?? null)
})
