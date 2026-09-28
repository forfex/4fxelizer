import { definePass, packStruct, type Size } from '../pass'

export const DOWNSCALE_METHODS = [
  { id: 'nearest', label: 'Nearest', hint: 'Picks one texel per block. Crisp, can drop details.' },
  { id: 'bilinear', label: 'Bilinear', hint: 'Blends the 4 texels nearest the block center.' },
  { id: 'bicubic', label: 'Bicubic', hint: 'Smooth, slightly sharp (Catmull-Rom).' },
  { id: 'box', label: 'Box / area', hint: 'Exact average of each block. Soft, no aliasing.' },
  { id: 'lanczos', label: 'Lanczos', hint: 'Sharpest smooth filter (Lanczos-3); may ring on hard edges.' },
  { id: 'dominant', label: 'Dominant color', hint: 'Most common color in each block. Flat, painterly areas.' },
  { id: 'median', label: 'Median', hint: 'The most central existing color of each block; removes specks.' },
  { id: 'kuwahara', label: 'Edge-preserving', hint: 'Kuwahara-style: averages the calmest part of each block, keeps edges hard.' },
  { id: 'contrast', label: 'Contrast-aware', hint: 'Averages, but favors dark texels so thin dark lines survive.' }
] as const

export type DownscaleMethod = (typeof DOWNSCALE_METHODS)[number]['id']

export interface DownscaleParams {
  method: DownscaleMethod
  /** longest: longest side = `longest`, aspect kept; exact: width × height; scale: input × scale. */
  sizeMode: 'longest' | 'exact' | 'scale'
  longest: number
  width: number
  height: number
  scale: number
  /** Round each side to the nearest power of two. */
  pot: boolean
  /** Dominant color: how similar colors must be to count as the same (OKLab distance). */
  tolerance: number
  /** Contrast-aware: how strongly dark texels win. */
  detail: number
}

export const DEFAULT_DOWNSCALE: DownscaleParams = {
  method: 'box',
  sizeMode: 'longest',
  longest: 128,
  width: 128,
  height: 128,
  scale: 0.25,
  pot: false,
  tolerance: 0.06,
  detail: 0.5
}

/** Largest output side; also bounds the per-stage texture size. */
export const MAX_DOWNSCALE_SIDE = 8192

function nearestPot(v: number): number {
  return 2 ** Math.round(Math.log2(Math.max(v, 1)))
}

export function downscaleSize(input: Size, p: DownscaleParams): Size {
  let w: number
  let h: number
  if (p.sizeMode === 'exact') {
    w = p.width
    h = p.height
  } else if (p.sizeMode === 'scale') {
    w = input.width * p.scale
    h = input.height * p.scale
  } else {
    const k = p.longest / Math.max(input.width, input.height)
    w = input.width * k
    h = input.height * k
  }
  const fix = (v: number): number => {
    const r = Math.max(1, Math.round(v))
    return Math.min(p.pot ? nearestPot(r) : r, MAX_DOWNSCALE_SIDE)
  }
  return { width: fix(w), height: fix(h) }
}

/** Taps per axis cap for the filter kernels (keeps huge reductions bounded). */
const MAX_TAPS = 64
/** Samples per axis for the block statistics methods (dominant, median, …). */
const BLOCK_SAMPLES = 12

export const downscale = definePass<DownscaleParams>({
  id: 'downscale',
  label: 'Downscale',
  wgsl: /* wgsl */ `
struct Params { method: u32, tolerance: f32, detail: f32, _p: f32 }

const MAX_TAPS = ${MAX_TAPS};
const BLOCK = ${BLOCK_SAMPLES};
const PI = 3.14159265;

fn texel(p: vec2i) -> vec4f {
  let dims = vec2i(textureDimensions(src));
  return textureLoad(src, clamp(p, vec2i(0), dims - 1), 0);
}

fn sinc(x: f32) -> f32 {
  if (abs(x) < 1e-5) { return 1.0; }
  let px = PI * x;
  return sin(px) / px;
}

fn kernel(method: u32, t: f32) -> f32 {
  let x = abs(t);
  if (method == 2u) { // Catmull-Rom
    if (x < 1.0) { return 1.5 * x * x * x - 2.5 * x * x + 1.0; }
    if (x < 2.0) { return -0.5 * x * x * x + 2.5 * x * x - 4.0 * x + 2.0; }
    return 0.0;
  }
  // Lanczos-3
  if (x < 3.0) { return sinc(x) * sinc(x / 3.0); }
  return 0.0;
}

/** Overlap of texel [i, i+1) with [a, b). */
fn overlap(i: f32, a: f32, b: f32) -> f32 {
  return max(min(i + 1.0, b) - max(i, a), 0.0);
}

/** Alpha-weighted accumulation, so transparent texels don't darken their neighbors. */
struct Acc { premul: vec3f, straight: vec3f, alpha: f32, w: f32 }

fn accumulate(acc: ptr<function, Acc>, c: vec4f, w: f32) {
  (*acc).premul += c.rgb * c.a * w;
  (*acc).straight += c.rgb * w;
  (*acc).alpha += c.a * w;
  (*acc).w += w;
}

fn resolve(acc: Acc) -> vec4f {
  let w = select(acc.w, 1.0, abs(acc.w) < 1e-6);
  let a = acc.alpha / w;
  let rgb = select(acc.straight / w, acc.premul / acc.alpha, a > 1.0 / 512.0);
  return clamp(vec4f(rgb, a), vec4f(0.0), vec4f(1.0));
}

fn filtered(center: vec2f, scale: vec2f) -> vec4f {
  let method = params.method;
  let fs = max(scale, vec2f(1.0));
  var acc = Acc(vec3f(0.0), vec3f(0.0), 0.0, 0.0);
  if (method == 3u) {
    // Box: exact area coverage of the footprint.
    let a = center - scale * 0.5;
    let b = center + scale * 0.5;
    let lo = vec2i(floor(a));
    let hi = vec2i(ceil(b));
    let stride = max(vec2i(1), (hi - lo + MAX_TAPS - 1) / MAX_TAPS);
    for (var y = lo.y; y < hi.y; y += stride.y) {
      let wy = overlap(f32(y), a.y, b.y) * f32(stride.y);
      for (var x = lo.x; x < hi.x; x += stride.x) {
        let wx = overlap(f32(x), a.x, b.x) * f32(stride.x);
        accumulate(&acc, texel(vec2i(x, y)), wx * wy);
      }
    }
    return resolve(acc);
  }
  let radius = select(3.0, 2.0, method == 2u) * fs;
  let lo = vec2i(floor(center - radius));
  let hi = vec2i(ceil(center + radius));
  let stride = max(vec2i(1), (hi - lo + MAX_TAPS - 1) / MAX_TAPS);
  for (var y = lo.y; y < hi.y; y += stride.y) {
    let wy = kernel(method, (f32(y) + 0.5 - center.y) / fs.y);
    if (wy == 0.0) { continue; }
    for (var x = lo.x; x < hi.x; x += stride.x) {
      let wx = kernel(method, (f32(x) + 0.5 - center.x) / fs.x);
      accumulate(&acc, texel(vec2i(x, y)), wx * wy);
    }
  }
  return resolve(acc);
}

/** Grid samples inside a block (the block statistics methods work on these). */
var<private> samples: array<vec4f, ${BLOCK_SAMPLES * BLOCK_SAMPLES}>;
var<private> labs: array<vec3f, ${BLOCK_SAMPLES * BLOCK_SAMPLES}>;
/** Grid dimensions of the last gather. */
var<private> grid: vec2u;

fn gather(a: vec2f, b: vec2f) -> u32 {
  let n = vec2u(clamp(ceil(b - a), vec2f(1.0), vec2f(f32(BLOCK))));
  let step = (b - a) / vec2f(n);
  grid = n;
  var count = 0u;
  for (var j = 0u; j < n.y; j++) {
    for (var i = 0u; i < n.x; i++) {
      let c = texel(vec2i(floor(a + (vec2f(f32(i), f32(j)) + 0.5) * step)));
      samples[count] = c;
      labs[count] = rgbToOklab(c.rgb);
      count++;
    }
  }
  return count;
}

/** Color distance including alpha, so transparent and opaque texels never merge. */
fn sampleDist(i: u32, j: u32) -> f32 {
  let d = labs[i] - labs[j];
  let da = samples[i].a - samples[j].a;
  return dot(d, d) + da * da;
}

fn dominant(count: u32) -> vec4f {
  let tol = params.tolerance * params.tolerance;
  var best = 0u;
  var bestN = 0u;
  for (var i = 0u; i < count; i++) {
    var n = 0u;
    for (var j = 0u; j < count; j++) { if (sampleDist(i, j) <= tol) { n++; } }
    if (n > bestN) { bestN = n; best = i; }
  }
  var acc = Acc(vec3f(0.0), vec3f(0.0), 0.0, 0.0);
  for (var j = 0u; j < count; j++) {
    if (sampleDist(best, j) <= tol) { accumulate(&acc, samples[j], 1.0); }
  }
  return resolve(acc);
}

fn vectorMedian(count: u32) -> vec4f {
  var best = 0u;
  var bestSum = 1e30;
  for (var i = 0u; i < count; i++) {
    var s = 0.0;
    for (var j = 0u; j < count; j++) { s += sqrt(sampleDist(i, j)); }
    if (s < bestSum) { bestSum = s; best = i; }
  }
  return samples[best];
}

fn contrastAware(count: u32) -> vec4f {
  var meanL = 0.0;
  var wa = 0.0;
  for (var i = 0u; i < count; i++) { meanL += labs[i].x * samples[i].a; wa += samples[i].a; }
  meanL = meanL / max(wa, 1e-4);
  var acc = Acc(vec3f(0.0), vec3f(0.0), 0.0, 0.0);
  for (var i = 0u; i < count; i++) {
    let w = exp(clamp((meanL - labs[i].x) * params.detail * 24.0, -8.0, 8.0));
    accumulate(&acc, samples[i], w);
  }
  return resolve(acc);
}

/** Kuwahara: mean of the quadrant (of a 1.5× block) with the lowest lightness variance. */
fn kuwahara(center: vec2f, scale: vec2f) -> vec4f {
  let half = max(scale * 0.75, vec2f(1.0));
  let count = gather(center - half, center + half);
  var bestVar = 1e30;
  var best = vec4f(0.0);
  for (var q = 0u; q < 4u; q++) {
    var acc = Acc(vec3f(0.0), vec3f(0.0), 0.0, 0.0);
    var sum = 0.0;
    var sum2 = 0.0;
    var k = 0.0;
    for (var i = 0u; i < count; i++) {
      let gx = i % grid.x;
      let gy = i / grid.x;
      let inX = select(gx * 2u + 1u >= grid.x, gx * 2u + 1u <= grid.x, (q & 1u) == 0u);
      let inY = select(gy * 2u + 1u >= grid.y, gy * 2u + 1u <= grid.y, (q & 2u) == 0u);
      if (!(inX && inY)) { continue; }
      accumulate(&acc, samples[i], 1.0);
      sum += labs[i].x;
      sum2 += labs[i].x * labs[i].x;
      k += 1.0;
    }
    if (k == 0.0) { continue; }
    let m = sum / k;
    let v = sum2 / k - m * m;
    if (v < bestVar) { bestVar = v; best = resolve(acc); }
  }
  return best;
}

fn run(p: vec2u, size: vec2u) -> vec4f {
  let srcSize = vec2f(textureDimensions(src));
  let scale = srcSize / vec2f(size);
  let center = (vec2f(p) + 0.5) * scale;
  switch params.method {
    case 0u: { return texel(vec2i(floor(center))); }
    case 1u: { return textureSampleLevel(src, linearSampler, center / srcSize, 0.0); }
    case 2u, 3u, 4u: { return filtered(center, scale); }
    case 5u: { return dominant(gather(center - scale * 0.5, center + scale * 0.5)); }
    case 6u: { return vectorMedian(gather(center - scale * 0.5, center + scale * 0.5)); }
    case 7u: { return kuwahara(center, scale); }
    default: { return contrastAware(gather(center - scale * 0.5, center + scale * 0.5)); }
  }
}
`,
  pack: (p) =>
    packStruct(
      ['u', Math.max(0, DOWNSCALE_METHODS.findIndex((m) => m.id === p.method))],
      ['f', p.tolerance],
      ['f', p.detail],
      ['f', 0]
    ),
  outputSize: downscaleSize
})
