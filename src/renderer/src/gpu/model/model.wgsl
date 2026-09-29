// 3D view: draws the model into a (usually low-res) framebuffer with the PSX quirks switchable:
// vertex snapping, affine texture mapping, gouraud lighting and 15-bit dithered color. blit.wgsl
// then scales that framebuffer up to the canvas with nearest sampling.

struct Frame {
  viewProj: mat4x4f,
  /** xyz: direction the light travels (world space); w: ambient light. */
  light: vec4f,
  /** xy: half the snap grid in pixels; z: snap vertices; w: affine texture mapping. */
  grid: vec4f,
  /** x: lighting; y: 15-bit dither; z: texture view (0 = color, 1 + map channel = grayscale channel). */
  opts: vec4f,
}

struct Part {
  color: vec4f,
  /** x: 1 = read the texture, 0 = flat color. */
  textured: vec4f,
}

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var texSampler: sampler;
@group(1) @binding(0) var<uniform> part: Part;

struct VertexIn {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
}

struct VertexOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  /** The same UV, interpolated linearly in screen space: affine mapping. */
  @location(1) @interpolate(linear) uvAffine: vec2f,
  @location(2) shade: f32,
}

@vertex
fn vs(v: VertexIn) -> VertexOut {
  var clip = frame.viewProj * vec4f(v.position, 1.0);
  if (frame.grid.z > 0.5 && clip.w > 0.0) {
    // Snap to whole pixels of the grid, as the PSX's integer vertex coordinates did.
    let ndc = round(clip.xy / clip.w * frame.grid.xy) / frame.grid.xy;
    clip = vec4f(ndc * clip.w, clip.z, clip.w);
  }
  var out: VertexOut;
  out.clip = clip;
  out.uv = v.uv;
  out.uvAffine = v.uv;
  let lambert = max(dot(normalize(v.normal), -frame.light.xyz), 0.0);
  out.shade = select(1.0, frame.light.w + (1.0 - frame.light.w) * lambert, frame.opts.x > 0.5);
  return out;
}

/** The PSX GPU's 4×4 dither offsets, added in 8-bit units before truncating to 5 bits. */
const DITHER = array<f32, 16>(-4.0, 0.0, -3.0, 1.0, 2.0, -2.0, 3.0, -1.0, -3.0, 1.0, -4.0, 0.0, 3.0, -1.0, 2.0, -2.0);

fn channelOf(c: vec4f, channel: u32) -> f32 {
  switch channel {
    case 1u: { return c.r; }
    case 2u: { return c.g; }
    case 3u: { return c.b; }
    case 4u: { return c.a; }
    default: { return dot(c.rgb, vec3f(0.2126, 0.7152, 0.0722)); }
  }
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
  let uv = select(in.uv, in.uvAffine, frame.grid.w > 0.5);
  let texel = textureSample(tex, texSampler, uv);
  var color = part.color;
  if (part.textured.x > 0.5) {
    color = texel;
    let view = u32(frame.opts.z);
    if (view > 0u) { color = vec4f(vec3f(channelOf(texel, view - 1u)), 1.0); }
  }
  // Binary transparency, like the PSX's.
  if (color.a < 0.5) { discard; }
  var rgb = clamp(color.rgb * in.shade, vec3f(0.0), vec3f(1.0));
  if (frame.opts.y > 0.5) {
    let p = vec2u(in.clip.xy) % 4u;
    let q = floor(clamp(rgb * 255.0 + DITHER[p.y * 4u + p.x], vec3f(0.0), vec3f(255.0)) / 8.0);
    rgb = q / 31.0;
  }
  return vec4f(rgb, 1.0);
}
