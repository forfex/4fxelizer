// WGSL helpers available to every pass (prepended by pass.ts after the bindings).
// Color values in the pipeline are sRGB-encoded, straight alpha.

export const WGSL_LIB = /* wgsl */ `
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

/** Input texel for output texel p (resampled when the stage changes the size). */
fn inputAt(p: vec2u, size: vec2u) -> vec4f {
  let srcSize = textureDimensions(src);
  if (all(srcSize == size)) { return textureLoad(src, p, 0); }
  let uv = (vec2f(p) + 0.5) / vec2f(size);
  return textureSampleLevel(src, linearSampler, uv, 0.0);
}

// ── Palette ─────────────────────────────────────────────────────────────────

fn paletteCount() -> u32 { return stage.paletteCount; }
fn paletteRgb(i: u32) -> vec3f { return palette[i].color.rgb; }

/** Distance in OKLab (metric 0) or RGB (metric 1). */
fn paletteDist(lab: vec3f, rgb: vec3f, i: u32, metric: u32) -> f32 {
  if (metric == 1u) { let d = rgb - palette[i].color.rgb; return dot(d, d); }
  let d = lab - palette[i].lab.xyz;
  return dot(d, d);
}

/** Index of the nearest palette color. Callers check paletteCount() > 0 first. */
fn nearestIndex(rgb: vec3f, metric: u32) -> u32 {
  let lab = rgbToOklab(rgb);
  var best = 0u;
  var bestD = 1e30;
  for (var i = 0u; i < stage.paletteCount; i++) {
    let d = paletteDist(lab, rgb, i, metric);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** The two nearest palette colors: (index of nearest, index of second nearest). */
fn nearestTwo(rgb: vec3f, metric: u32) -> vec2u {
  let lab = rgbToOklab(rgb);
  var b0 = 0u; var d0 = 1e30;
  var b1 = 0u; var d1 = 1e30;
  for (var i = 0u; i < stage.paletteCount; i++) {
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

fn blendStage(base: vec4f, top: vec4f) -> vec4f {
  let rgb = mix(base.rgb, blendRgb(stage.blendMode, base.rgb, top.rgb), stage.opacity);
  return vec4f(rgb, mix(base.a, top.a, stage.opacity));
}
`
