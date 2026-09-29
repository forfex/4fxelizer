// WGSL helpers available to every pass (prepended by pass.ts after the bindings).
// Color values in the pipeline are sRGB-encoded, straight alpha.

/** Color conversions; need no bindings, so other shaders (masks) use them too. */
export const WGSL_COLOR = /* wgsl */ `
fn srgbToLinear3(c: vec3f) -> vec3f {
  return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045));
}

fn linearToSrgb3(c: vec3f) -> vec3f {
  let x = max(c, vec3f(0.0));
  return select(1.055 * pow(x, vec3f(1.0 / 2.4)) - 0.055, x * 12.92, x <= vec3f(0.0031308));
}

/** sRGB-encoded RGB → OKLab (matches color/oklab.ts). */
fn rgbToOklab(c: vec3f) -> vec3f {
  let l = srgbToLinear3(clamp(c, vec3f(0.0), vec3f(1.0)));
  let lms = vec3f(
    dot(l, vec3f(0.4122214708, 0.5363325363, 0.0514459929)),
    dot(l, vec3f(0.2119034982, 0.6806995451, 0.1073969566)),
    dot(l, vec3f(0.0883024619, 0.2817188376, 0.6299787005)));
  let r = pow(max(lms, vec3f(0.0)), vec3f(1.0 / 3.0));
  return vec3f(
    dot(r, vec3f(0.2104542553, 0.7936177850, -0.0040720468)),
    dot(r, vec3f(1.9779984951, -2.4285922050, 0.4505937099)),
    dot(r, vec3f(0.0259040371, 0.7827717662, -0.8086757660)));
}

fn oklabToRgb(lab: vec3f) -> vec3f {
  let r = vec3f(
    dot(lab, vec3f(1.0, 0.3963377774, 0.2158037573)),
    dot(lab, vec3f(1.0, -0.1055613458, -0.0638541728)),
    dot(lab, vec3f(1.0, -0.0894841775, -1.2914855480)));
  let lms = r * r * r;
  let lin = vec3f(
    dot(lms, vec3f(4.0767416621, -3.3077115913, 0.2309699292)),
    dot(lms, vec3f(-1.2684380046, 2.6097574011, -0.3413193965)),
    dot(lms, vec3f(-0.0041960863, -0.7034186147, 1.7076147010)));
  return clamp(linearToSrgb3(lin), vec3f(0.0), vec3f(1.0));
}

fn luma(c: vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}
`

export const WGSL_LIB = /* wgsl */ `
${WGSL_COLOR}

/** Input texel for output texel p (resampled when the stage changes the size). */
fn inputAt(p: vec2u, size: vec2u) -> vec4f {
  let srcSize = textureDimensions(src);
  if (all(srcSize == size)) { return textureLoad(src, p, 0); }
  let uv = (vec2f(p) + 0.5) / vec2f(size);
  return textureSampleLevel(src, linearSampler, uv, 0.0);
}

/**
 * The stage's mask at output texel p: 1 = full effect. Built before the stage runs (see mask.ts);
 * 1 everywhere when the stage has no mask.
 */
fn maskAt(p: vec2u, size: vec2u) -> f32 {
  let dims = textureDimensions(maskTex);
  if (all(dims == size)) { return textureLoad(maskTex, p, 0).r; }
  let uv = (vec2f(p) + 0.5) / vec2f(size);
  return textureSampleLevel(maskTex, linearSampler, uv, 0.0).r;
}

/** The stage blend's mask at output texel p (see StageBlend.mask): 1 = the stage's full result. */
fn blendMaskAt(p: vec2u, size: vec2u) -> f32 {
  let dims = textureDimensions(blendMaskTex);
  if (all(dims == size)) { return textureLoad(blendMaskTex, p, 0).r; }
  let uv = (vec2f(p) + 0.5) / vec2f(size);
  return textureSampleLevel(blendMaskTex, linearSampler, uv, 0.0).r;
}

// ── Palette ─────────────────────────────────────────────────────────────────

fn paletteCount() -> u32 { return stage.paletteCount; }
fn paletteRgb(i: u32) -> vec3f { return palette[i].color.rgb; }

// The palette buffer holds the colors twice (see gpu/resources.ts): entries [0, n) sorted by OKLab
// lightness for perceptual matching, entries [n, 2n) sorted by (r+g+b)/√3 for RGB matching. The
// sort key is in lab.w. Its squared difference is a lower bound on the distance, so searches start
// at the pixel's key and stop as soon as the bound exceeds the best distance found: exact, and
// fast even with thousands of colors.

/** Distance in OKLab (metric 0) or RGB (metric 1). */
fn paletteDist(lab: vec3f, rgb: vec3f, i: u32, metric: u32) -> f32 {
  if (metric == 1u) { let d = rgb - palette[i].color.rgb; return dot(d, d); }
  let d = lab - palette[i].lab.xyz;
  return dot(d, d);
}

fn paletteBase(metric: u32) -> u32 { return select(0u, stage.paletteCount, metric == 1u); }

fn paletteKey(lab: vec3f, rgb: vec3f, metric: u32) -> f32 {
  return select(lab.x, (rgb.r + rgb.g + rgb.b) * 0.5773502692, metric == 1u);
}

/** First position in the sorted half whose key is >= key. */
fn paletteLowerBound(base: u32, key: f32) -> u32 {
  var lo = 0u;
  var hi = stage.paletteCount;
  while (lo < hi) {
    let mid = (lo + hi) / 2u;
    if (palette[base + mid].lab.w < key) { lo = mid + 1u; } else { hi = mid; }
  }
  return lo;
}

/** Buffer index of the nearest palette color. Callers check paletteCount() > 0 first. */
fn nearestIndex(rgb: vec3f, metric: u32) -> u32 {
  let lab = rgbToOklab(rgb);
  let n = stage.paletteCount;
  let base = paletteBase(metric);
  let key = paletteKey(lab, rgb, metric);
  let start = paletteLowerBound(base, key);
  var best = base;
  var bestD = 1e30;
  for (var j = start; j < n; j++) {
    let dk = palette[base + j].lab.w - key;
    if (dk * dk > bestD) { break; }
    let d = paletteDist(lab, rgb, base + j, metric);
    if (d < bestD) { bestD = d; best = base + j; }
  }
  for (var j = i32(start) - 1; j >= 0; j--) {
    let dk = key - palette[base + u32(j)].lab.w;
    if (dk * dk > bestD) { break; }
    let d = paletteDist(lab, rgb, base + u32(j), metric);
    if (d < bestD) { bestD = d; best = base + u32(j); }
  }
  return best;
}

/** The two nearest palette colors: (buffer index of nearest, of second nearest). */
fn nearestTwo(rgb: vec3f, metric: u32) -> vec2u {
  let lab = rgbToOklab(rgb);
  let n = stage.paletteCount;
  let base = paletteBase(metric);
  let key = paletteKey(lab, rgb, metric);
  let start = paletteLowerBound(base, key);
  var b0 = base; var d0 = 1e30;
  var b1 = base; var d1 = 1e30;
  for (var j = start; j < n; j++) {
    let dk = palette[base + j].lab.w - key;
    if (dk * dk > d1) { break; }
    let i = base + j;
    let d = paletteDist(lab, rgb, i, metric);
    if (d < d0) { b1 = b0; d1 = d0; b0 = i; d0 = d; }
    else if (d < d1) { b1 = i; d1 = d; }
  }
  for (var j = i32(start) - 1; j >= 0; j--) {
    let dk = key - palette[base + u32(j)].lab.w;
    if (dk * dk > d1) { break; }
    let i = base + u32(j);
    let d = paletteDist(lab, rgb, i, metric);
    if (d < d0) { b1 = b0; d1 = d0; b0 = i; d0 = d; }
    else if (d < d1) { b1 = i; d1 = d; }
  }
  if (d1 >= 1e30) { b1 = b0; }
  return vec2u(b0, b1);
}

// ── Dither thresholds (0..1, mean 0.5) ──────────────────────────────────────

/** Bayer matrix threshold for an n×n matrix (n = 2, 4, 8, 16). */
fn bayer(p: vec2u, n: u32) -> f32 {
  var xc = (p.x ^ p.y) % n;
  var yc = p.y % n;
  var v = 0u;
  for (var s = n; s > 1u; s = s >> 1u) {
    v = (v << 2u) | ((xc & 1u) << 1u) | (yc & 1u);
    xc = xc >> 1u;
    yc = yc >> 1u;
  }
  return (f32(v) + 0.5) / f32(n * n);
}

/** Blue-noise threshold from the shared tiling pattern texture. */
fn blueNoise(p: vec2u) -> f32 {
  let dims = textureDimensions(pattern);
  return textureLoad(pattern, p % dims, 0).r;
}

// ── Stage blend ─────────────────────────────────────────────────────────────

fn blendRgb(mode: u32, b: vec3f, t: vec3f) -> vec3f {
  switch mode {
    case 1u: { return b * t; }                                  // multiply
    case 2u: { return 1.0 - (1.0 - b) * (1.0 - t); }            // screen
    case 3u: {                                                  // overlay
      return select(1.0 - 2.0 * (1.0 - b) * (1.0 - t), 2.0 * b * t, b < vec3f(0.5));
    }
    case 4u: {                                                  // soft light (W3C)
      let d = select(sqrt(b), ((16.0 * b - 12.0) * b + 4.0) * b, b <= vec3f(0.25));
      return select(b + (2.0 * t - 1.0) * (d - b), b - (1.0 - 2.0 * t) * b * (1.0 - b), t <= vec3f(0.5));
    }
    case 5u: { return min(b + t, vec3f(1.0)); }                 // add
    case 6u: { return max(b - t, vec3f(0.0)); }                 // subtract
    case 7u: { return abs(b - t); }                             // difference
    case 8u: { return min(b, t); }                              // darken
    case 9u: { return max(b, t); }                              // lighten
    case 10u: {                                                 // luminosity
      let lb = rgbToOklab(b);
      return oklabToRgb(vec3f(rgbToOklab(t).x, lb.yz));
    }
    case 11u: {                                                 // color
      let lt = rgbToOklab(t);
      return oklabToRgb(vec3f(rgbToOklab(b).x, lt.yz));
    }
    default: { return t; }                                      // normal
  }
}

fn blendStage(base: vec4f, top: vec4f, p: vec2u, size: vec2u) -> vec4f {
  var amount = stage.opacity;
  if (stage.blendMask == 1u) { amount *= clamp(blendMaskAt(p, size), 0.0, 1.0); }
  let rgb = mix(base.rgb, blendRgb(stage.blendMode, base.rgb, top.rgb), amount);
  return vec4f(rgb, mix(base.a, top.a, amount));
}
`
