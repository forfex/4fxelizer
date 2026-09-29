// 3D view: draws the model into a framebuffer (low-res for the console looks) in the style the
// user picked: unlit, gouraud (per-vertex light, like the consoles) or per-pixel lit (key, fill and
// rim lights, sky ambient, GGX highlights, shadow map, the AO / roughness / metallic maps), with an
// optional wireframe, and the console quirks: vertex snapping, affine texture mapping, the N64's
// 3-point filter, 15/16-bit color with the PSX or N64 dither. blit.wgsl then scales the
// framebuffer up to the canvas.
//
// Vertices are pulled from storage buffers by index, so every triangle knows its corners
// (barycentric coordinates for the wireframe) without a de-indexed copy of the mesh.

struct Frame {
  viewProj: mat4x4f,
  lightViewProj: mat4x4f,
  /** xyz: camera position; w: wire width in framebuffer pixels. */
  eye: vec4f,
  /** xyz: direction the key light travels; w: ambient light. */
  key: vec4f,
  /** xyz: direction the fill light travels; w: specular strength. */
  fill: vec4f,
  /** xyz: direction the rim light travels; w: exposure. */
  rim: vec4f,
  /** xy: half the snap grid in pixels; z: snap vertices; w: affine texture mapping. */
  grid: vec4f,
  /** x: fog start distance; y: fog end distance; z: fog amount; w: world size of a shadow-map texel. */
  fog: vec4f,
  background: vec4f,
  wire: vec4f,
  /** x: shading; y: surface; z: unused; w: filter. */
  mode: vec4u,
  /** x: wireframe; y: 5 bits per channel; z: dither; w: shadows. */
  mode2: vec4u,
}

/** One material, drawn with its own texture (and that texture's maps) or its flat color. */
struct Part {
  color: vec4f,
  /** x: 1 = read the texture, 0 = flat color; y: texture view (0 = color, 1 + map channel = grayscale channel). */
  textured: vec4f,
  /** 1 + channel of the texture's AO, roughness and metallic maps (0 = none). */
  maps: vec4u,
}

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var shadowMap: texture_depth_2d;
@group(0) @binding(2) var shadowSampler: sampler_comparison;
@group(0) @binding(3) var<storage, read> vertices: array<f32>;
@group(0) @binding(4) var<storage, read> indices: array<u32>;
@group(1) @binding(0) var<uniform> part: Part;
@group(2) @binding(0) var tex: texture_2d<f32>;
@group(2) @binding(1) var aoTex: texture_2d<f32>;
@group(2) @binding(2) var roughTex: texture_2d<f32>;
@group(2) @binding(3) var metalTex: texture_2d<f32>;

const SHADING_UNLIT = 0u;
const SHADING_VERTEX = 1u;
const SURFACE_TEXTURE = 0u;
const SURFACE_NORMALS = 2u;
const FILTER_NEAREST = 0u;
const FILTER_BILINEAR = 1u;
const WIRE_OVERLAY = 1u;
const WIRE_ONLY = 2u;
const DITHER_PSX = 1u;
const DITHER_N64 = 2u;
/** Vertex layout: position (3 floats), normal (3), uv (2); see modelGpu.ts. */
const VERTEX_FLOATS = 8u;
const PI = 3.14159265;

struct Vertex {
  position: vec3f,
  normal: vec3f,
  uv: vec2f,
}

fn vertexAt(i: u32) -> Vertex {
  let o = indices[i] * VERTEX_FLOATS;
  return Vertex(
    vec3f(vertices[o], vertices[o + 1u], vertices[o + 2u]),
    vec3f(vertices[o + 3u], vertices[o + 4u], vertices[o + 5u]),
    vec2f(vertices[o + 6u], vertices[o + 7u])
  );
}

fn safeNormalize(v: vec3f) -> vec3f {
  let l = length(v);
  return select(vec3f(0.0, 1.0, 0.0), v / l, l > 1e-8);
}

struct VertexOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  /** The same UV, interpolated linearly in screen space: affine mapping. */
  @location(1) @interpolate(linear) uvAffine: vec2f,
  @location(2) world: vec3f,
  @location(3) normal: vec3f,
  /** Gouraud light. */
  @location(4) shade: f32,
  /** Barycentric coordinates (1 at the triangle's own corner): distance to the edges. */
  @location(5) bary: vec3f,
}

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VertexOut {
  let v = vertexAt(i);
  var clip = frame.viewProj * vec4f(v.position, 1.0);
  if (frame.grid.z > 0.5 && clip.w > 0.0) {
    // Snap to whole pixels of the grid, as the PSX's integer vertex coordinates did.
    let ndc = round(clip.xy / clip.w * frame.grid.xy) / frame.grid.xy;
    clip = vec4f(ndc * clip.w, clip.z, clip.w);
  }
  let n = safeNormalize(v.normal);
  let corner = i % 3u;
  var out: VertexOut;
  out.clip = clip;
  out.uv = v.uv;
  out.uvAffine = v.uv;
  out.world = v.position;
  out.normal = n;
  out.shade = frame.key.w + (1.0 - frame.key.w) * max(dot(n, -frame.key.xyz), 0.0);
  out.bary = vec3f(f32(corner == 0u), f32(corner == 1u), f32(corner == 2u));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Texture filtering (done by hand, so the N64's 3-point filter sits next to nearest and bilinear)

fn texelAt(t: texture_2d<f32>, p: vec2i) -> vec4f {
  let size = vec2i(textureDimensions(t));
  return textureLoad(t, ((p % size) + size) % size, 0);
}

fn sampleTexture(t: texture_2d<f32>, uv: vec2f, filterMode: u32) -> vec4f {
  let size = vec2f(textureDimensions(t));
  if (filterMode == FILTER_NEAREST) { return texelAt(t, vec2i(floor(uv * size))); }
  let st = uv * size - 0.5;
  let b = vec2i(floor(st));
  let f = fract(st);
  let c00 = texelAt(t, b);
  let c10 = texelAt(t, b + vec2i(1, 0));
  let c01 = texelAt(t, b + vec2i(0, 1));
  let c11 = texelAt(t, b + vec2i(1, 1));
  if (filterMode == FILTER_BILINEAR) { return mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y); }
  // The N64's 3-point filter: blend the three texels of the triangle the sample falls in.
  if (f.x + f.y <= 1.0) { return c00 + f.x * (c10 - c00) + f.y * (c01 - c00); }
  return c11 + (1.0 - f.x) * (c01 - c11) + (1.0 - f.y) * (c10 - c11);
}

fn channelOf(c: vec4f, channel: u32) -> f32 {
  switch channel {
    case 1u: { return c.r; }
    case 2u: { return c.g; }
    case 3u: { return c.b; }
    case 4u: { return c.a; }
    default: { return dot(c.rgb, vec3f(0.2126, 0.7152, 0.0722)); }
  }
}

/** A map's value at uv, or `fallback` when there is no map (`slot` = 1 + channel, 0 = none). */
fn mapValue(t: texture_2d<f32>, uv: vec2f, slot: u32, fallback: f32) -> f32 {
  if (slot == 0u) { return fallback; }
  return clamp(channelOf(sampleTexture(t, uv, FILTER_BILINEAR), slot - 1u), 0.0, 1.0);
}

// ---------------------------------------------------------------------------------------------
// Per-pixel lighting (linear light, GGX specular, ACES tone mapping)

const KEY_COLOR = vec3f(1.0, 0.95, 0.88) * 2.6;
const FILL_COLOR = vec3f(0.55, 0.65, 0.85) * 0.5;
const RIM_COLOR = vec3f(0.9, 0.9, 1.0) * 1.6;
const SKY = vec3f(0.62, 0.68, 0.8);
const GROUND = vec3f(0.3, 0.26, 0.23);

/** Fraction of the key light reaching `world` (3×3 PCF on the shadow map). */
fn shadowAt(world: vec3f, n: vec3f) -> f32 {
  // Push the lookup off the surface (normal offset) so it doesn't shadow itself.
  let p = frame.lightViewProj * vec4f(world + n * frame.fog.w * 2.0, 1.0);
  let uv = p.xy * vec2f(0.5, -0.5) + 0.5;
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || p.z > 1.0) { return 1.0; }
  let texel = 1.0 / vec2f(textureDimensions(shadowMap));
  var sum = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      sum += textureSampleCompareLevel(shadowMap, shadowSampler, uv + vec2f(f32(x), f32(y)) * texel * 1.5, p.z - 0.001);
    }
  }
  return sum / 9.0;
}

fn directLight(n: vec3f, v: vec3f, l: vec3f, radiance: vec3f, diffuse: vec3f, f0: vec3f, roughness: f32) -> vec3f {
  let nl = dot(n, l);
  if (nl <= 0.0) { return vec3f(0.0); }
  let h = normalize(l + v);
  let nh = max(dot(n, h), 0.0);
  let nv = max(dot(n, v), 1e-4);
  let vh = max(dot(v, h), 0.0);
  let a = roughness * roughness;
  let a2 = a * a;
  let dd = nh * nh * (a2 - 1.0) + 1.0;
  let d = a2 / (PI * dd * dd);
  let k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
  let g = (nl / (nl * (1.0 - k) + k)) * (nv / (nv * (1.0 - k) + k));
  let f = f0 + (1.0 - f0) * pow(1.0 - vh, 5.0);
  let specular = d * g * f / (4.0 * nl * nv) * frame.fill.w;
  return ((1.0 - f) * diffuse / PI + specular) * radiance * nl;
}

/** ACES filmic curve (Narkowicz's fit). */
fn tonemap(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}

fn litColor(albedoSrgb: vec3f, n: vec3f, world: vec3f, uv: vec2f) -> vec3f {
  let albedo = pow(max(albedoSrgb, vec3f(0.0)), vec3f(2.2));
  let v = safeNormalize(frame.eye.xyz - world);
  let ao = mapValue(aoTex, uv, part.maps.x, 1.0);
  let roughness = clamp(mapValue(roughTex, uv, part.maps.y, 0.7), 0.08, 1.0);
  let metallic = mapValue(metalTex, uv, part.maps.z, 0.0);
  let f0 = mix(vec3f(0.04), albedo, metallic);
  let diffuse = albedo * (1.0 - metallic);

  let shadow = select(1.0, shadowAt(world, n), frame.mode2.w == 1u);
  var color = directLight(n, v, -frame.key.xyz, KEY_COLOR, diffuse, f0, roughness) * shadow * mix(1.0, ao, 0.4);
  color += directLight(n, v, -frame.fill.xyz, FILL_COLOR, diffuse, f0, roughness) * ao;
  color += directLight(n, v, -frame.rim.xyz, RIM_COLOR, diffuse, f0, roughness) * ao;
  // Sky above, ground below; reflections of it on smooth and metal surfaces.
  let hemi = mix(GROUND, SKY, n.y * 0.5 + 0.5) * frame.key.w;
  let reflected = mix(GROUND, SKY, reflect(-v, n).y * 0.5 + 0.5) * frame.key.w;
  let fresnel = f0 + (max(vec3f(1.0 - roughness), f0) - f0) * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  color += (diffuse * hemi + fresnel * reflected * (1.0 - roughness) * (1.0 - roughness) * frame.fill.w) * ao;
  return pow(tonemap(color * frame.rim.w), vec3f(1.0 / 2.2));
}

// ---------------------------------------------------------------------------------------------

/** The PSX GPU's 4×4 dither offsets, added in 8-bit units before truncating to 5 bits. */
const DITHER_PSX_MATRIX = array<f32, 16>(-4.0, 0.0, -3.0, 1.0, 2.0, -2.0, 3.0, -1.0, -3.0, 1.0, -4.0, 0.0, 3.0, -1.0, 2.0, -2.0);
/** The N64 RDP's "magic square" dither, the same way. */
const DITHER_N64_MATRIX = array<f32, 16>(0.0, 6.0, 1.0, 7.0, 4.0, 2.0, 5.0, 3.0, 3.0, 5.0, 2.0, 4.0, 7.0, 1.0, 6.0, 0.0);

/** Cuts to 5 bits per channel (with the chosen dither) when the style asks for it. */
fn colorDepth(rgb: vec3f, pixel: vec2f) -> vec3f {
  if (frame.mode2.y == 0u) { return rgb; }
  let p = vec2u(pixel) % 4u;
  var offset = 0.0;
  if (frame.mode2.z == DITHER_PSX) { offset = DITHER_PSX_MATRIX[p.y * 4u + p.x]; }
  if (frame.mode2.z == DITHER_N64) { offset = DITHER_N64_MATRIX[p.y * 4u + p.x]; }
  return floor(clamp(rgb * 255.0 + offset, vec3f(0.0), vec3f(255.0)) / 8.0) / 31.0;
}

@fragment
fn fs(in: VertexOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  // Wire coverage first: derivatives need uniform control flow.
  let pixels = in.bary / max(fwidth(in.bary), vec3f(1e-6));
  let halfWidth = frame.eye.w * 0.5;
  let wire = (1.0 - smoothstep(halfWidth - 0.5, halfWidth + 0.5, min(pixels.x, min(pixels.y, pixels.z)))) * frame.wire.a;

  if (frame.mode2.x == WIRE_ONLY) {
    return vec4f(mix(frame.background.rgb, frame.wire.rgb, wire), 1.0);
  }

  let uv = select(in.uv, in.uvAffine, frame.grid.w > 0.5);
  var base = part.color;
  if (part.textured.x > 0.5) {
    let texel = sampleTexture(tex, uv, frame.mode.w);
    base = texel;
    let view = u32(part.textured.y);
    if (view > 0u) { base = vec4f(vec3f(channelOf(texel, view - 1u)), 1.0); }
  }
  // Binary transparency, like the consoles'.
  if (frame.mode.y == SURFACE_TEXTURE && base.a < 0.5) { discard; }
  let albedo = select(clamp(base.rgb, vec3f(0.0), vec3f(1.0)), vec3f(0.62), frame.mode.y != SURFACE_TEXTURE);
  // Two-sided: the back of a face is lit like its front.
  let n = select(-1.0, 1.0, front) * safeNormalize(in.normal);

  var rgb: vec3f;
  if (frame.mode.y == SURFACE_NORMALS) {
    // The normal as stored (not turned towards the viewer), so flipped faces stand out.
    rgb = safeNormalize(in.normal) * 0.5 + 0.5;
  } else if (frame.mode.x == SHADING_UNLIT) {
    rgb = albedo;
  } else if (frame.mode.x == SHADING_VERTEX) {
    rgb = clamp(albedo * in.shade, vec3f(0.0), vec3f(1.0));
  } else {
    rgb = litColor(albedo, n, in.world, uv);
  }

  if (frame.fog.z > 0.0) {
    let d = distance(in.world, frame.eye.xyz);
    rgb = mix(rgb, frame.background.rgb, frame.fog.z * smoothstep(frame.fog.x, frame.fog.y, d));
  }
  if (frame.mode2.x == WIRE_OVERLAY) {
    rgb = mix(rgb, frame.wire.rgb, wire);
  }
  return vec4f(colorDepth(rgb, in.clip.xy), 1.0);
}

// ---------------------------------------------------------------------------------------------
// Shadow map: depth from the key light (cut-out texels don't cast shadows).

struct ShadowOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vsShadow(@builtin(vertex_index) i: u32) -> ShadowOut {
  let v = vertexAt(i);
  return ShadowOut(frame.lightViewProj * vec4f(v.position, 1.0), v.uv);
}

@fragment
fn fsShadow(in: ShadowOut) {
  if (part.textured.x > 0.5 && frame.mode.y == SURFACE_TEXTURE && part.textured.y < 0.5) {
    if (sampleTexture(tex, in.uv, FILTER_NEAREST).a < 0.5) { discard; }
  }
}
