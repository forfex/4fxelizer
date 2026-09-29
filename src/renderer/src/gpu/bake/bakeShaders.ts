// WGSL of map baking. `trace` shaders shoot rays from each G-buffer texel through the model's BVH
// and add one value per sample to the texel's accumulator; `resolve` turns the accumulators into
// a grayscale map. BVH traversal must match traceBvh in model/bvh.ts.

import { MAX_DEPTH } from '@/model/bvh'
import { WORK_FORMAT } from '../pass'

/** What a trace pass adds per sample (see TRACE_KINDS in baker.ts). */
export const TRACE = { occlusion: 0, thickness: 1, curvature: 2, height: 3, up: 4 } as const

/** How resolve turns a mean into the map value. */
export const RESOLVE = { invert: 0, plain: 1, curvature: 2, edge: 3 } as const

const COMMON = /* wgsl */ `
struct Node { lo: vec3f, leftFirst: u32, hi: vec3f, count: u32 }
struct Tri { v0: vec4f, e1: vec4f, e2: vec4f }

const EMPTY: u32 = 0xffffffffu;
`

export const TRACE_WGSL = /* wgsl */ `
${COMMON}
struct Params {
  size: vec2u,
  kind: u32,
  /** Index of the first sample of this dispatch, and how many it takes. */
  sampleStart: u32,
  sampleCount: u32,
  /** Ignore hits on the back of triangles (AO). */
  cull: u32,
  _p0: u32,
  _p1: u32,
  /** Ray length in world units (occlusion, thickness) or probe radius (curvature). */
  distance: f32,
  /** Occlusion: 0 = every hit counts fully, 1 = far hits count less. */
  falloff: f32,
  /** Ray start offset off the surface, in world units. */
  bias: f32,
  _p2: f32,
  /** Model bounds (height map). */
  lo: vec4f,
  hi: vec4f,
}

@group(0) @binding(0) var<storage, read> nodes: array<Node>;
@group(0) @binding(1) var<storage, read> tris: array<Tri>;
@group(0) @binding(2) var<storage, read> gPosition: array<vec4f>;
@group(0) @binding(3) var<storage, read> gNormal: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> accum: array<f32>;
@group(0) @binding(5) var<uniform> params: Params;

struct Hit { t: f32, tri: u32 }

/** Möller–Trumbore; the distance, or -1. \`cull\` skips triangles hit from behind. */
fn intersect(k: u32, o: vec3f, d: vec3f, tmin: f32, tmax: f32, cull: bool) -> f32 {
  let tri = tris[k];
  let e1 = tri.e1.xyz;
  let e2 = tri.e2.xyz;
  if (cull && dot(cross(e1, e2), d) > 0.0) { return -1.0; }
  let p = cross(d, e2);
  let det = dot(e1, p);
  if (abs(det) < 1e-12) { return -1.0; }
  let inv = 1.0 / det;
  let s = o - tri.v0.xyz;
  let u = dot(s, p) * inv;
  if (u < 0.0 || u > 1.0) { return -1.0; }
  let q = cross(s, e1);
  let v = dot(d, q) * inv;
  if (v < 0.0 || u + v > 1.0) { return -1.0; }
  let t = dot(e2, q) * inv;
  if (t > tmin && t < tmax) { return t; }
  return -1.0;
}

fn boxHit(n: u32, o: vec3f, inv: vec3f, tmin: f32, tmax: f32) -> bool {
  let node = nodes[n];
  let a = (node.lo - o) * inv;
  let b = (node.hi - o) * inv;
  let t0 = max(max(max(min(a.x, b.x), min(a.y, b.y)), min(a.z, b.z)), tmin);
  let t1 = min(min(min(max(a.x, b.x), max(a.y, b.y)), max(a.z, b.z)), tmax);
  return t0 <= t1;
}

/** Closest hit within (0, tmax), skipping triangle \`skip\` (the one the ray starts on). */
fn trace(o: vec3f, d: vec3f, tmax: f32, skip: u32, cull: bool) -> Hit {
  var best = Hit(tmax, EMPTY);
  // Axis-parallel rays: a tiny component instead of 0 keeps the slab test free of NaNs.
  let inv = 1.0 / select(d, vec3f(1e-12), abs(d) < vec3f(1e-12));
  // Depth-first, children pushed in pairs: never more than the tree's depth + 1 entries.
  var stack: array<u32, ${MAX_DEPTH + 2}>;
  var top = 1u;
  stack[0] = 0u;
  while (top > 0u) {
    top -= 1u;
    let n = stack[top];
    if (!boxHit(n, o, inv, 0.0, best.t)) { continue; }
    let node = nodes[n];
    if (node.count > 0u) {
      for (var k = node.leftFirst; k < node.leftFirst + node.count; k++) {
        if (k == skip) { continue; }
        let t = intersect(k, o, d, 0.0, best.t, cull);
        if (t >= 0.0) { best = Hit(t, k); }
      }
    } else {
      stack[top] = node.leftFirst;
      stack[top + 1u] = node.leftFirst + 1u;
      top += 2u;
    }
  }
  return best;
}

/** Orthonormal basis around n (Duff et al. 2017). */
fn tangents(n: vec3f) -> mat3x3f {
  let s = select(-1.0, 1.0, n.z >= 0.0);
  let a = -1.0 / (s + n.z);
  let b = n.x * n.y * a;
  return mat3x3f(vec3f(1.0 + s * n.x * n.x * a, s * b, -s * n.x), vec3f(b, s + n.y * n.y * a, -n.y), n);
}

fn hash(x: u32) -> u32 {
  var h = x * 747796405u + 2891336453u;
  h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
  return (h >> 22u) ^ h;
}

/** Sample i of a 2D low-discrepancy sequence (R2), shifted per texel so neighbors don't correlate. */
fn sample2(i: u32, texel: u32) -> vec2f {
  let h = hash(texel);
  let shift = vec2f(f32(h & 0xffffu), f32(h >> 16u)) / 65536.0;
  return fract(vec2f(f32(i) * 0.7548776662, f32(i) * 0.5698402910) + shift);
}

fn cosineDirection(u: vec2f, frame: mat3x3f) -> vec3f {
  let r = sqrt(u.x);
  let phi = 6.283185307 * u.y;
  return normalize(frame * vec3f(r * cos(phi), r * sin(phi), sqrt(max(1.0 - u.x, 0.0))));
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= params.size.x || id.y >= params.size.y) { return; }
  let texel = id.y * params.size.x + id.x;
  let gn = gNormal[texel];
  if (gn.w == 0.0) { return; }
  let gp = gPosition[texel];
  let p = gp.xyz;
  let own = bitcast<u32>(gp.w);
  let n = normalize(gn.xyz);
  // Geometric normal of the texel's triangle, on the side the shading normal faces.
  let tri = tris[own];
  var ng = normalize(cross(tri.e1.xyz, tri.e2.xyz));
  if (dot(ng, n) < 0.0) { ng = -ng; }

  var sum = 0.0;
  switch params.kind {
    case ${TRACE.height}u: {
      sum = clamp((p.y - params.lo.y) / max(params.hi.y - params.lo.y, 1e-9), 0.0, 1.0);
    }
    case ${TRACE.up}u: {
      sum = max(n.y, 0.0);
    }
    case ${TRACE.occlusion}u: {
      let frame = tangents(n);
      let o = p + ng * params.bias;
      for (var i = 0u; i < params.sampleCount; i++) {
        let d = cosineDirection(sample2(params.sampleStart + i, texel), frame);
        let hit = trace(o, d, params.distance, own, params.cull == 1u);
        if (hit.tri != EMPTY) { sum += mix(1.0, 1.0 - hit.t / params.distance, params.falloff); }
      }
    }
    case ${TRACE.thickness}u: {
      let frame = tangents(-n);
      let o = p - ng * params.bias;
      for (var i = 0u; i < params.sampleCount; i++) {
        let d = cosineDirection(sample2(params.sampleStart + i, texel), frame);
        let hit = trace(o, d, params.distance, own, false);
        sum += select(1.0, hit.t / params.distance, hit.tri != EMPTY);
      }
    }
    default: {
      // Curvature probes: from a point \`r\` out along the surface and \`r\` above it, look down.
      // Farther than r (or nothing) = the surface falls away: convex. A wall in the way, or the
      // surface closer than r = concave.
      let frame = tangents(n);
      let r = params.distance;
      let o = p + ng * params.bias;
      for (var i = 0u; i < params.sampleCount; i++) {
        let u = sample2(params.sampleStart + i, texel);
        let phi = 6.283185307 * u.x;
        // Jittered radius spreads the probes over the disc, so creases fade out smoothly.
        let dist = r * (0.5 + 0.5 * u.y);
        let q = p + (frame[0] * cos(phi) + frame[1] * sin(phi)) * dist + n * dist;
        let toQ = q - o;
        let len = length(toQ);
        let side = trace(o, toQ / len, len, own, false);
        if (side.tri != EMPTY) {
          sum -= 1.0 - side.t / len;
          continue;
        }
        let down = trace(q, -n, dist * 2.0, EMPTY, false);
        sum += select(1.0, clamp((down.t - dist) / dist, -1.0, 1.0), down.tri != EMPTY);
      }
    }
  }
  accum[texel] += sum;
}
`

export const RESOLVE_WGSL = /* wgsl */ `
struct Params {
  size: vec2u,
  mode: u32,
  _p0: u32,
  /** 1 / samples taken so far. */
  scale: f32,
  /** Curvature contrast. */
  strength: f32,
  /** Value of texels no triangle covers (outside the padded islands). */
  background: f32,
  _p1: f32,
}

@group(0) @binding(0) var<storage, read> gNormal: array<vec4f>;
@group(0) @binding(1) var<storage, read> accum: array<f32>;
@group(0) @binding(2) var<uniform> params: Params;
@group(0) @binding(3) var dst: texture_storage_2d<${WORK_FORMAT}, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= params.size.x || id.y >= params.size.y) { return; }
  let texel = id.y * params.size.x + id.x;
  var v = params.background;
  if (gNormal[texel].w != 0.0) {
    let mean = accum[texel] * params.scale;
    switch params.mode {
      case ${RESOLVE.invert}u: { v = 1.0 - mean; }
      case ${RESOLVE.curvature}u: { v = 0.5 + 0.5 * clamp(mean * params.strength, -1.0, 1.0); }
      case ${RESOLVE.edge}u: { v = clamp(mean * params.strength, 0.0, 1.0); }
      default: { v = mean; }
    }
  }
  textureStore(dst, vec2i(id.xy), vec4f(vec3f(clamp(v, 0.0, 1.0)), 1.0));
}
`
