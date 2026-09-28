# 4FXELIZER — Plan

**4FXELIZER** (reads "fixelizer" / "pixelizer", with 4FX inside the name) is a desktop tool that turns high-resolution textures into PSX-style low-res, palettized, dithered textures,
with 3D model import and map baking (AO, cavity, curvature) to drive where dithering happens.
Target users: artists, not programmers.

## Decisions

| Topic | Decision |
|---|---|
| Platforms | Windows, macOS, Linux |
| Shell | **Electron** (bundled Chromium = identical rendering + WebGPU on every OS) |
| Build/packaging | **electron-vite** (dev/build), **electron-builder** (NSIS / DMG / AppImage + deb) |
| UI | **React + TypeScript**, **Tailwind CSS** + **shadcn/ui (Radix)** restyled into a **retro UI** (see "Visual style"), **Zustand** (state + undo/redo) |
| Design hand-off | UI designed in **Figma** + Figma variables → mapped 1:1 to CSS variables / Tailwind tokens |
| Image processing | **WebGPU** (WGSL) passes, each stage cached |
| CPU algorithms | TypeScript in **Web Workers** first (k-means, median cut, error diffusion); move hot paths to **Rust → WASM** only if profiling says so (no native modules → no per-OS builds) |
| 3D | **three.js** + **three-mesh-bvh** (GPU ray tracing for baking) |
| Model formats | glTF/GLB, FBX, OBJ(+MTL) via three.js loaders; **assimpjs** (WASM) fallback for problem FBX files + extras (DAE, 3DS, PLY) |
| Missing UVs | auto-unwrap with **xatlas** (WASM) |
| Export | PNG (RGBA + 8-bit indexed with palette), TGA, BMP; palettes .gpl/.act/.hex; later PSX .TIM |

### Risks to verify early (Phase 0)
- WebGPU on Linux in Electron may need `--enable-unsafe-webgpu` / Vulkan flags depending on GPU driver. Test on a real Linux box.
  Fallback: run image passes as fragment shaders on WebGL2 (same algorithms, GLSL instead of WGSL).
- macOS distribution requires code signing + notarization (Apple Developer account).
- FBX: three.js FBXLoader supports FBX 7.x (binary/ASCII); older files go through assimpjs.

## Processing pipeline (non-destructive, user-ordered stack)

The pipeline is a **reorderable stack of stages**, like adjustment layers in Photoshop. Users can
drag stages into any order, add the same stage type more than once, and switch any stage on or off.

```
Source ─► [ stage ] ─► [ stage ] ─► [ stage ] ─► … ─► Output (optional palette lock)
             ▲ drag to reorder, duplicate, toggle, blend

Shared project resources (usable by any stage):
  Palettes · Baked maps (AO, cavity, curvature/edge, thickness) · Texture masks (luminance, edges, painted)
```

Default order: Adjust → Downscale → Quantize → Dither. Examples of orders that give different looks:
- Dither → Downscale: dither at full resolution, then downscale → softer, blended grain.
- Downscale → Dither: crisp, pixel-sized dither pattern.
- Quantize → Dither vs. Dither → Quantize: see the Dither modes below.
- Two Dither stages with different patterns and masks (e.g. lines in cavities, Bayer everywhere else).

### Stage model
- Every stage is a self-contained function: image in → image out, plus access to shared resources.
  Stages don't assume what ran before them.
- Every stage has its own **blend**: opacity, blend mode, and an optional mask. The stage's result
  is blended over its input. This is also where "blending options" live.
- **Palettes are project resources**, not owned by the Quantize stage. Quantize and Dither both
  pick a palette. A palette can be generated from the source image or from the image at that point in the stack.
- **Dither modes** make any order meaningful:
  - *To palette*: the pattern and the palette snap happen together (classic dithering).
  - *To levels*: reduce to N levels per channel, e.g. 5-bit per channel for PSX.
  - *Pattern only*: adds the pattern as an offset without snapping; a later Quantize does the snap.
- Masks and baked maps are sampled in normalized UV coordinates, so they work at any resolution
  in the stack (before or after Downscale).
- **Output palette lock** (optional, on by default for indexed/PSX export): blending or later
  stages can create colors that aren't in the palette; the lock snaps the final result back to it.

### Stack UI
- Drag to reorder, "+" menu to add stages, duplicate, delete, on/off toggle.
- Click a stage to **preview the image at that point** in the stack.
- Warnings when an order is likely unintended (e.g. "Adjust after Quantize produces off-palette colors").

### Performance
- Each stage caches its output. Changing a setting re-runs only that stage and the ones after it;
  reordering re-runs from the first moved stage.
- Whole setup = JSON **recipe** (ordered stage list + resources) → presets, project files, batch processing.

## Features

### Adjust
Gamma, brightness/contrast, saturation, hue shift, levels, pre-sharpen, optional AO/cavity multiply into color (baked-lighting look).

### Downscale
Nearest, bilinear, bicubic, box/area, Lanczos, **dominant color** (mode per block), median,
edge-preserving (Kuwahara-style), contrast-aware (keeps thin dark details). Target size presets (64/128/256, power-of-two lock) or custom.

### Quantize / palettes
- Generate: median cut, k-means, octree, Wu — distances in **OKLab**. Controls: color count, quality/iterations, gamma, saturation/luminance weighting.
- Palette editor: add/remove/lock/sort colors, eyedropper, extract from image, import Lospec formats (.hex/.gpl/.pal/.ase).
- Built-in palettes: NES, PICO-8, Game Boy, CGA, …
- **Shared palette across a texture set** (all textures on one model).
- **PSX constraints mode**: 15-bit color (5:5:5), 4bpp (16) / 8bpp (256) CLUT, power-of-two ≤ 256×256.

### Dither
- Ordered: Bayer 2×2 / 4×4 / 8×8, **blue noise**, lines (H/V/diagonal), crosshatch, halftone dots, checker, custom pattern image.
- Error diffusion: Floyd–Steinberg, Atkinson, Jarvis, Stucki, Sierra (with wrap-around option).
- Controls: strength, pattern scale, "dither between two nearest palette colors only".
- **Tiling:** ordered/blue-noise tile seamlessly when pattern size divides texture size; warn for error diffusion.

### Masks (where to dither)
- Sources: AO, cavity, convexity/edge, curvature, thickness (baked); luminance, Sobel edges (from texture); hand-painted.
- Per-mask: threshold, falloff, invert, contrast, blur. Combine: multiply / add / min / max.
- Different dither pattern inside vs. outside the mask.

### 3D
- Import glTF/GLB, FBX, OBJ. Auto-detect texture assignments.
- **PSX preview shader**: affine texture warping, vertex snapping, no filtering, low-res framebuffer.

### Map sources
Each map slot (AO, cavity, edge, curvature, thickness, normal, …) can come from one of three places:
1. **Baked in the app** from the imported model (main workflow).
2. **Imported** from Substance, Blender, Marmoset, etc. Auto-detected by filename suffix
   (`_ao`, `_cavity`, `_curvature`, `_thickness`, `_normal`) and channel-packed maps (e.g. glTF ORM: R = AO).
3. **Generated from the texture alone** (no model): height estimated from luminance, then cavity/edges from
   high-pass filtering and AO-like shading from blurred height. Lower quality, but works for a single texture.

### Baking (in-app)
All bakes run on the GPU in **UV space**: the result lines up with the model's textures.

1. **Texture-space G-buffer.** Rasterize the mesh using its UVs as screen positions. Output per-texel world
   position, world normal (with normal map applied if present), triangle ID and a coverage mask.
   Supersample (bake at 2×, downsample) so thin triangles aren't missed.
2. **BVH.** Build a bounding-volume hierarchy of the mesh (three-mesh-bvh, in a worker), flatten it into a GPU
   storage buffer, and trace rays in WGSL compute shaders.
3. **Per-map algorithms:**
   - **AO**: cosine-weighted hemisphere rays around the normal, fraction that hit geometry within a max distance.
     Settings: samples, max distance (relative to model size), falloff, ignore back-faces.
   - **Cavity**: same as AO but with a very short max distance, so only small crevices darken.
   - **Curvature → Edge + Cavity**: convex vs. concave signal from two sources, combined:
     mesh curvature (from vertex normals/neighbors) for shape-level edges, and normal-map divergence at
     several blur scales for detail-level edges. Split into an **Edge** map (convex) and a **Cavity** map (concave).
   - **Thickness**: rays cast into the mesh (opposite the normal); average hit distance, normalized.
   - **Cheap extras** straight from the G-buffer: world-space normal, "up-facing" (top-down dust/moss mask),
     height gradient (Y position), material/object ID.
4. **Edge padding (dilation)**: extend each UV island outward by N pixels so there are no seams
   when the map is sampled or downscaled.
5. **Progressive refinement**: samples accumulate over several frames; the map sharpens while the UI stays
   responsive, and the user can stop early.

Rough cost: 2048² texels × 64 rays ≈ 270M rays → a few seconds on a mid-range GPU for a typical low-poly game mesh.
Bake resolution is independent of texture resolution (masks are sampled in UV), so 1024² is usually enough.

### Baking edge cases
- **Overlapping / mirrored UVs**: detected (texels hit by more than one triangle) and flagged, with an option
  to average or bake only the first layer.
- **Multiple materials / UV sets**: bake per texture set; choose the UV channel.
- **No UVs**: auto-unwrap with xatlas (only useful for untextured models, since existing textures need the original UVs).
- **Ray self-hits / acne**: offset the ray origin along the normal, scaled to model size.
- **Later**: high-poly → low-poly baking (project detail from a high-poly mesh with a cage), like Substance/Marmoset.

### PBR maps (low priority)
Metallic/roughness/specular: same downscale, no dither/quantize (or grayscale quantize).

### UI
Before/after split view, zoom with pixel grid, 3D viewport tab, collapsible stage panels with on/off toggles,
presets ("PSX 8bpp", "PSX 4bpp", "NES-ish", "Crunchy"), undo/redo, drag & drop, batch export, tooltips on every setting.

## Visual style: retro, not pixelated
Late-90s / early-2000s software feel (PS1 menus, classic desktop apps, old 3D and audio tools) with
modern readability. Crisp and characterful, but not a pixel-art costume. shadcn/ui copies component
source into the project and Radix supplies only behavior, so every visual detail is ours to restyle.

- **Bevels and panels**: 1–2px raised/sunken bevels (hard `box-shadow`s), chiseled group boxes with titles in the border,
  inset wells for image previews and value fields. Small or square corners, no big soft shadows.
- **Crisp lines at any scaling**: border and bevel widths are rounded to whole screen pixels (via `devicePixelRatio`),
  so 1px lines stay sharp at Windows 125%/150% and on Retina/HiDPI.
- **Fonts**: a normal, readable UI font for labels and body text; a monospace or LCD-style font for numeric readouts;
  an optional retro display font for headings only.
- **Color**: dark theme with muted, slightly warm or desaturated tones and a small set of accent colors (like status LEDs).
- **Icons**: simple, crisp, lightly retro icon set; custom icons for stages and maps.
- **Controls**: slightly chunky sliders with tick marks, beveled buttons with a clear pressed state, value readouts in
  "LCD" boxes, palette swatches as square tiles.
- **Retro accents, used sparingly**: subtle dither pattern in headers or disabled states, optional scanline toggle for the preview.
- **Motion**: short and snappy, no floaty easing.
- **Readability first**: dense tool with many sliders; text size and contrast get checked on real screens.

## Design workflow
1. Designer works in Figma, with component names that match the shadcn/ui components (Button, Slider, Select…).
2. Colors, spacing, radii, typography defined as **Figma variables** → exported to CSS variables / Tailwind config.
3. Hand-off via Figma Dev Mode MCP (if the Figma plan allows) or shared frame exports/screenshots.
4. Until designs exist, the app ships a neutral token-driven theme, so restyling later is cheap.

## Roadmap
0. **Foundation** — Electron + React + Vite skeleton, WebGPU pass framework, image load/save, 2D viewer (zoom, pixel grid, split view). Verify WebGPU on Win/macOS/Linux.
1. **2D core (first usable version)** — reorderable stage stack with per-stage blend + preview-at-stage, adjust, downscale modes, palette generation + editor, ordered + blue-noise dither, indexed PNG export.
   *Status: implemented, verified on Windows. Not in yet: per-stage masks (Phase 2), octree/Wu palette
   generation, palette eyedropper, TGA/BMP export.*
2. **Dither expansion** — line/halftone/error-diffusion dithers, texture-derived masks, imported map slots, mask blending, presets.
   *Status: error diffusion (8 kernels), lines/halftone/clustered/noise patterns, Knoll mixing, dither saturation,
   texture-derived masks (edges/flats/tones/saturation, strength + gamma, mask view) and presets are in.
   Not yet: crosshatch/checker/custom pattern images, serpentine and wrap-around diffusion, imported map
   slots, mask blur/invert/combining, different patterns inside vs. outside the mask.*
3. **3D** — model import (glTF/FBX/OBJ), viewport, PSX preview shader, UV G-buffer + BVH ray tracing,
   AO/cavity/curvature/edge/thickness baking with edge padding and progressive refinement.
4. **Mask-driven dithering** using baked maps.
5. **Polish** — project files, batch processing, shared palettes, PBR maps, TIM export, onboarding, installers for all OSes.
