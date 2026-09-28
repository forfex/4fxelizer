// 2D viewer: draws the before/after textures into the canvas with zoom, pan,
// split view, pixel grid and an alpha checkerboard. All positions are device pixels.
// Both textures are stretched over the same on-screen rect (the source extent), so a
// downscaled result lines up with its source in split view. The tiling view repeats that rect
// around itself (tiles × tiles copies) so seams show.

struct View {
  canvasSize: vec2f,
  imageSize: vec2f,   // on-screen reference size in image pixels (source size)
  offset: vec2f,      // top-left of the image in the canvas
  zoom: f32,
  splitX: f32,        // left of this x shows `before`; < 0 disables split
  gridMin: f32,       // minimum on-screen texel size for the grid; 0 disables it
  checkerSize: f32,
  hasImage: f32,
  tiles: f32,        // copies per side, the image in the middle
  background: vec4f,
  checkerA: vec4f,
  checkerB: vec4f,
}

@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var beforeTex: texture_2d<f32>;
@group(0) @binding(2) var afterTex: texture_2d<f32>;
@group(0) @binding(3) var linearSampler: sampler;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

fn texelOnScreen(dims: vec2f) -> f32 {
  return view.zoom * view.imageSize.x / dims.x;
}

fn sampleTex(t: texture_2d<f32>, uv: vec2f) -> vec4f {
  let dims = vec2f(textureDimensions(t));
  // Magnified: exact nearest texel. Minified: filtered, to avoid shimmering.
  if (texelOnScreen(dims) >= 1.0) {
    let tc = min(vec2i(floor(uv * dims)), vec2i(dims) - 1);
    return textureLoad(t, tc, 0);
  }
  return textureSampleLevel(t, linearSampler, uv, 0.0);
}

fn onGrid(t: texture_2d<f32>, uv: vec2f) -> bool {
  let dims = vec2f(textureDimensions(t));
  let spacing = texelOnScreen(dims);
  if (view.gridMin <= 0.0 || spacing < view.gridMin) { return false; }
  // One device pixel on the top/left edge of every texel.
  let e = fract(uv * dims) * spacing;
  return e.x < 1.0 || e.y < 1.0;
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let img = (pos.xy - view.offset) / view.zoom;
  let side = (max(view.tiles, 1.0) - 1.0) * 0.5;
  if (view.hasImage < 0.5 || any(img < -side * view.imageSize) || any(img >= (1.0 + side) * view.imageSize)) {
    return view.background;
  }
  let uv = fract(img / view.imageSize);
  let useBefore = pos.x < view.splitX;

  var c: vec4f;
  var grid: bool;
  if (useBefore) {
    c = sampleTex(beforeTex, uv);
    grid = onGrid(beforeTex, uv);
  } else {
    c = sampleTex(afterTex, uv);
    grid = onGrid(afterTex, uv);
  }

  let cell = floor(pos.xy / view.checkerSize);
  let checker = select(view.checkerA, view.checkerB, (u32(cell.x + cell.y) & 1u) == 1u);
  var rgb = mix(checker.rgb, c.rgb, clamp(c.a, 0.0, 1.0));

  if (grid) {
    // Dark lines on everything but near-black texels, where they'd vanish.
    let lum = dot(rgb, vec3f(0.299, 0.587, 0.114));
    rgb = select(mix(rgb, vec3f(1.0), 0.18), rgb * 0.72, lum > 0.12);
  }
  return vec4f(rgb, 1.0);
}
