// Scales the 3D view's framebuffer up to the canvas, nearest texel (keeps low-res pixels square-edged).

@group(0) @binding(0) var frameTex: texture_2d<f32>;
/** xy: framebuffer size divided by canvas size. */
@group(0) @binding(1) var<uniform> scale: vec4f;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let size = textureDimensions(frameTex);
  let texel = min(vec2u(pos.xy * scale.xy), size - 1u);
  return textureLoad(frameTex, texel, 0);
}
