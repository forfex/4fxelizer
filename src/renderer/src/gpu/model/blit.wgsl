// Scales the 3D view's framebuffer up to the canvas: nearest texel (square-edged low-res pixels)
// or bilinear (soft, like a console on a TV).

@group(0) @binding(0) var frameTex: texture_2d<f32>;
/** xy: framebuffer size divided by canvas size; z: 1 = smooth. */
@group(0) @binding(1) var<uniform> scale: vec4f;
@group(0) @binding(2) var smoothSampler: sampler;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let size = textureDimensions(frameTex);
  let at = pos.xy * scale.xy;
  let soft = textureSampleLevel(frameTex, smoothSampler, at / vec2f(size), 0.0);
  let sharp = textureLoad(frameTex, min(vec2u(at), size - 1u), 0);
  return select(sharp, soft, scale.z > 0.5);
}
