<div align="center">

<img src="site/icon.svg" alt="" width="96" height="96">

# 4FXELIZER

**Turn high-res textures into crunchy PSX-style low-res, palettized, dithered ones, and see them on your model.**

[![CI](https://github.com/forfex/4fxelizer/actions/workflows/ci.yml/badge.svg)](https://github.com/forfex/4fxelizer/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/forfex/4fxelizer?color=d9a441)](https://github.com/forfex/4fxelizer/releases/latest)
![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux-2b2a27)
![WebGPU](https://img.shields.io/badge/WebGPU-compute-d9a441)
[![License: MIT](https://img.shields.io/badge/license-MIT-2b2a27)](LICENSE)

[**Download**](https://github.com/forfex/4fxelizer/releases/latest) · [**Website**](https://forfex.github.io/4fxelizer/) · [Report a bug](https://github.com/forfex/4fxelizer/issues)

<img src="site/images/app.png" alt="4FXELIZER showing a brick texture before and after" width="900">

</div>

4FXELIZER is a free desktop app for artists making textures for retro-styled games. Drop in a texture, stack a few
stages (downscale, quantize to a palette, dither) and export a texture that looks like it came off a PlayStation,
N64 or Game Boy cartridge. Load the model it belongs to and you see the result in a PSX-style 3D view as you tweak,
and can bake AO, cavity and other maps from the model to steer where the dithering goes.

Everything runs on your GPU (WebGPU), so changes show up instantly, even with 8192-color palettes and error
diffusion on big textures. Your images stay exact: no color-space conversion, no alpha premultiplication.

## Highlights

- **A reorderable stage stack**: Adjust, Downscale, Upscale, Quantize and Dither, each with opacity, blend mode
  and a live preview of the image at that point.
- **Palettes**: generate them from the image, start from classics (PICO-8, NES, Game Boy, CGA, C64, …), import
  and edit them, or let a stage build its own palette of 2–8192 colors.
- **Every dither you know**: Bayer, blue noise, halftone, the N64 magic square, your own pattern image, and error
  diffusion from Floyd–Steinberg to Sierra, all restrictable with a mask.
- **3D view**: glTF, GLB, FBX and OBJ models with switchable PSX quirks: vertex snapping, affine texture warping,
  a 240-line framebuffer, 15-bit dither.
- **Map baking**: AO, cavity, curvature, edge, thickness, height and up-facing maps, ray traced on the GPU in the
  model's UV space.
- **Presets and export**: PSX 8bpp/4bpp, N64, Game Boy and more built in; PNG, TGA or BMP out, full color or
  indexed.

## Gallery

One source texture through the built-in presets:

| Source | PSX 8bpp | PSX 4bpp | N64 |
|:--:|:--:|:--:|:--:|
| <img src="site/images/gallery-source.png" width="200"> | <img src="site/images/gallery-psx-8bpp.png" width="200"> | <img src="site/images/gallery-psx-4bpp.png" width="200"> | <img src="site/images/gallery-n64.png" width="200"> |

| NES-ish | Game Boy | Crunchy |
|:--:|:--:|:--:|
| <img src="site/images/gallery-nes.png" width="200"> | <img src="site/images/gallery-gameboy.png" width="200"> | <img src="site/images/gallery-crunchy.png" width="200"> |

## Install

Download the installer for your system from the [latest release](https://github.com/forfex/4fxelizer/releases/latest):

| System | File |
|---|---|
| Windows | `4fxelizer-<version>-setup.exe` |
| macOS (Apple Silicon or Intel) | `4fxelizer-<version>-arm64.dmg` or `-x64.dmg` |
| Linux | `.AppImage` or `.deb` |

**You need a GPU with WebGPU support** (any reasonably recent NVIDIA, AMD, Intel or Apple GPU with current
drivers). If the app can't find one, **Help › GPU Diagnostics…** tells you why.

The builds aren't code-signed yet:

- **Windows**: SmartScreen may warn about an unknown publisher. Click **More info › Run anyway**.
- **macOS**: if the app is reported as damaged, run `xattr -cr /Applications/4FXELIZER.app` in Terminal once.

## Quick start

1. **Open a texture**: drag it onto the window, or **File › Open Image…** (Ctrl+O). PNG, TGA, JPEG, BMP, WebP and GIF
   all work.
2. **Pick a preset**: toolbar › **Presets**, for example *PSX 8bpp*. The stack panel now shows the stages it
   added.
3. **Tweak**: drag the sliders, reorder stages, switch them on and off. Click a stage to see the image at that
   point; **Split View** (Ctrl+\\) compares before and after.
4. **Check it in 3D** (optional): **File › Open Model…** (Ctrl+Shift+O), or drop the model on the window.
5. **Export**: **File › Export…** (Ctrl+E).

## Features

### Stages

Shape the texture with a stack of stages you can reorder freely. Every stage has on/off, opacity and a blend
mode.

| Stage | What it does |
|---|---|
| **Adjust** | Brightness, contrast, gamma, saturation, hue, levels, sharpen, and shading from AO and cavity maps. |
| **Downscale** | Nearest, bilinear, bicubic, box, Lanczos, dominant color, median, edge-preserving or contrast-aware; to a longest side, an exact size or a scale, optionally power-of-two. |
| **Upscale** | ×2–×16 or back to the original size, with the N64 3-point filter, bilinear, bicubic, sharp bilinear, Lanczos, Scale2x/Scale3x (EPX) or nearest. Downscale → Dither → Upscale gives the N64 blur. |
| **Quantize** | Snap to a palette (perceptual OKLab or RGB matching) or to N levels per channel (32 = PSX 15-bit). |
| **Dither** | Ordered or error diffusion, to a palette, to levels, or pattern only (see below). |

**Dithering** comes in two families:

- *Ordered*: Bayer 2×2 to 16×16, blue noise, white noise, IGN, clustered dots, halftone, lines, checker,
  crosshatch, the N64 magic square, or your own pattern image. Palette mixing: offset, two nearest or Knoll.
- *Error diffusion*: Floyd–Steinberg, Atkinson, Jarvis–Judice–Ninke, Stucki, Burkes and three Sierra variants,
  with optional serpentine scanning.

**Wrap edges** makes error diffusion and mask filtering tile seamlessly. **View › Tiling View** (Ctrl+T) repeats
the texture 3×3 so you can spot seams.

### Masks and maps

A Dither stage can work only where you want it. Its **mask** comes from the image (edges, flats, shadows,
midtones, highlights, saturated, grays) or from a map (AO, cavity, curvature, edge, thickness, height,
roughness, metallic). Combine two sources (multiply, add, min, max), invert either, blur and shape the result,
and run a different pattern outside the mask. The mask view shows exactly what you're getting.

**Maps** load by themselves when they sit next to the texture with a recognizable name (`rock_ao.png`,
`Rock_AmbientOcclusion.tga`, `T_Rock_ORM.png`; ORM, ARM and RMA files are split into their channels). You can
also drop them on the window or load them per slot in the **Maps** panel. They don't need to match the texture's
size.

### Palettes

Quantize and Dither take their colors from a shared **palette** or from a **generated** palette of 2–8192
colors, rebuilt automatically from the stage's input.

- Generate from the image with median cut, Wu, octree or k-means (Wu and octree reach the requested count even
  on smooth gradients).
- Start from a built-in: PICO-8, NES, Game Boy, CGA, C64 and more.
- Import and export `.hex`, `.gpl`, `.pal`, `.act` and `.ase`.
- Edit and lock single colors, or pick them from the image with the eyedropper (**Pick**, or Alt+click the
  viewer).

### 3D view

Open a **glTF, GLB, FBX or OBJ** model and the **3D view** shows the processed texture on it while you work. Each
PSX quirk is a switch of its own: vertex snapping, affine texture warping, nearest texels, a 240- or 480-line
framebuffer, lighting and 15-bit dither.

The model's base color texture opens with it, whether it sits next to the file, in a common textures folder or
inside a GLB/FBX. If the texture you already have open belongs to the model, it stays.

### Map baking

The **Bake** panel bakes **AO, cavity, curvature, edge, thickness, height and up-facing** maps from the model's
shape, ray traced on the GPU in the model's UV space with edge padding, at up to 2048×2048. Maps sharpen while
they bake and you can stop early. Baked maps land straight in the map slots, so they drive masks and Adjust's
shading like imported ones. **Save…** in the Maps panel writes them as PNGs named so they load with the texture
next time.

### Presets and export

**Presets** save the whole stack to reuse on other textures. Built-ins: PSX 8bpp, PSX 4bpp, PSX 15-bit, N64,
NES-ish, Game Boy and Crunchy. Presets are small `.4fxpreset` files you can share.

**File › Export…** writes **PNG, TGA or BMP**, full color or **indexed**. Indexed export keeps the palette's
order and puts transparency at index 0 (indexed BMP has no alpha: transparent pixels use index 0,
semi-transparent ones become opaque).

### Workspace

- Panels dock, tab together, float and resize. Switch layouts from the toolbar's workspace menu (Essentials,
  Wide viewer, Palette editing, 3D, Floating) or save your own.
- Five themes in **View › Theme**: **Dark**, **Night** (neutral grey, for judging colors without tinted chrome),
  **Light**, **Matrix** and **Retro**.
- Undo and redo cover the stack and palettes.
- Sliders and dropdowns take the mouse wheel once you rest the pointer on them for a second (or click them), so
  scrolling a panel never changes a value by accident.
- The theme, view options, export format, 3D and bake settings, panel layout and window placement are remembered
  between sessions.

### Keyboard shortcuts

On macOS, use Cmd instead of Ctrl.

| Action | Shortcut | | Action | Shortcut |
|---|---|---|---|---|
| Open image | Ctrl+O | | Fit to window | Ctrl+0 |
| Open model | Ctrl+Shift+O | | Actual pixels | Ctrl+1 |
| Export | Ctrl+E | | Zoom in / out | Ctrl+= / Ctrl+- |
| Presets | Ctrl+Shift+P | | Pixel grid | Ctrl+G |
| Undo | Ctrl+Z | | Split view | Ctrl+\\ |
| Redo | Ctrl+Y (Shift+Cmd+Z) | | Tiling view | Ctrl+T |
| Pick color | Alt+click | | Full screen | F11 (Ctrl+Cmd+F) |

On Windows and Linux the menus live in the app's own title bar: Alt or F10 moves to them and Alt+letter opens
one. Some Linux desktops reserve Alt+click for moving windows; use the **Pick** button there.

## Troubleshooting

- **"No WebGPU" or a blank viewer**: update your GPU drivers, then check **Help › GPU Diagnostics…**. From a
  terminal, `4fxelizer --gpu-report=report.json` writes the same report without opening a window; attach it to
  a [bug report](https://github.com/forfex/4fxelizer/issues).
- **Linux**: the app turns on WebGPU and Vulkan by default. If it won't start, try launching with
  `FXELIZER_NO_GPU_FLAGS=1` to use Electron's defaults.

Tested so far on Windows 11 (NVIDIA RTX 5070 Ti). macOS and Linux builds are produced and launched in CI, but
haven't been checked on real GPUs yet; reports are very welcome.

## Building from source

You need [Node.js](https://nodejs.org/) 22 or newer.

```bash
git clone https://github.com/forfex/4fxelizer.git
cd 4fxelizer
npm install          # also downloads the Electron binary
npm run dev          # app with hot reload
```

| Command | What it does |
|---|---|
| `npm test` | unit tests (vitest) |
| `npm run typecheck` | TypeScript checks for main, preload, renderer and tests |
| `npm run build` | typecheck + production bundles in `out/` |
| `npm run dist` | installer for the current OS in `dist/` |

**Checking WebGPU on a machine**: `npm run build`, then `npx electron . --gpu-report`. It runs headless (adapter
info and limits, then a real upload → compute → readback test), writes `4fxelizer-gpu-report.json` and exits 0
on success.

<details>
<summary><b>Project layout</b></summary>

```
src/main/            Electron main: window, native menu, file dialogs, settings, GPU flags, --gpu-report
src/preload/         window.fx bridge (sandboxed, CommonJS)
src/shared/api.ts    IPC contract and user settings shared by main, preload and renderer
src/shared/menu.ts   the app menu, defined once: native menu in main, title bar menus in the renderer
src/shared/maps.ts   map slots and how map files are recognized by name (_ao, _cavity, _orm, …)
src/shared/model.ts  model file types and where to look for the files a model refers to
src/shared/bake.ts   bake and 3D view settings
src/renderer/src/
  gpu/pass.ts        pass framework: each stage = one WGSL compute function (+ blend, palette, mask, patterns)
  gpu/mask.ts        stage masks: sources (image-derived or imported maps), combine, blur, built on the GPU
  gpu/wgslLib.ts     WGSL helpers shared by all passes (OKLab, palette lookup, dither thresholds, blend)
  gpu/plan.ts        stage-cache planning (pure, unit-tested)
  gpu/chain.ts       runs the stage stack on the GPU with per-stage caching
  gpu/resources.ts   GPU copies of palettes, imported maps, custom patterns and the blue-noise texture
  gpu/viewer.*       2D viewer renderer: zoom, split view, tiling view, pixel grid, alpha checker
  gpu/passes/        stages: adjust, downscale, upscale, quantize, dither
  gpu/model/         3D view renderer (PSX look) and the model's GPU buffers
  gpu/bake/          map baking: BVH ray tracing from a texture-space G-buffer, progressive
  model/             model loading (three.js loaders, in a worker), BVH, UV rasterizer (pure, unit-tested)
  viewer3d/          orbit camera math
  color/             OKLab conversion
  palette/           palette model, generation (worker), file formats, built-ins, auto-regeneration
  dither/            blue-noise generator (void-and-cluster), custom pattern images
  stack/             document ops, presets, built-in presets, order warnings (pure, unit-tested)
  image/             PNG, TGA and BMP encoders (RGBA + indexed), TGA decoder, half-float readback
  viewer/viewport.ts zoom/pan math in device pixels
  engine.ts          owns GPU objects; React talks to it
  store.ts           app state + undoable document (zustand)
  workspace/         dockable panel layout: built-in workspaces, saved layouts and their checks
  components/        title bar, dock, stack panel, stage editors, palette, maps and bake panels, export dialog, viewer, 3D view
  components/ui/     shadcn-style primitives, restyled via tokens
  styles/tokens.css  design tokens: the one place to restyle the app
```

</details>

<details>
<summary><b>Notes for contributors</b></summary>

- **Adding a stage**: create `gpu/passes/<name>.ts` with `definePass` (a WGSL `run` function, a `Params` struct
  and `pack`), register it in `gpu/passes/index.ts` (`PASSES` + `STAGE_TYPES`), and add its settings editor in
  `components/stages/editors.tsx`.
- **Image values are kept exact**: images decode without color-space conversion or alpha premultiplication,
  stages work in `rgba16float`, and PNG export uses our own encoder (canvas encoding would premultiply alpha).
- **Everything is a devDependency**: the renderer bundles its libraries and main/preload have no runtime deps,
  so the packaged app ships only `out/`.
- **Vite 7, not 8**: electron-vite 5 supports Vite ≤ 7. Upgrade the two together.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, …).

</details>

<details>
<summary><b>CI, releases and the website</b></summary>

`.github/workflows/ci.yml` runs on every push and pull request, on Windows, macOS and Linux: typecheck, unit
tests, bundle, a headless launch of the app (`scripts/gpu-smoke.mjs`, which uses `--gpu-report`) and an unpacked
package build. The launch must succeed; missing WebGPU only warns, because hosted runners have no GPU (each run
uploads the GPU report as an artifact).

`.github/workflows/release.yml` builds the installers (Windows NSIS, macOS dmg for x64 and arm64, Linux AppImage
and deb) and publishes a GitHub release when a `v*` tag is pushed. Bump `version` in `package.json` first; the
tag must match it:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The landing page lives in `site/` and is deployed to GitHub Pages by `.github/workflows/pages.yml` on pushes to
`master` that touch it (one-time setup: **Settings › Pages › Source: GitHub Actions**).

</details>

## License

4FXELIZER is released under the [MIT License](LICENSE). It bundles open-source libraries (React, Radix UI,
dockview, zustand, three.js and a few small helpers, all MIT, ISC, Apache-2.0 or 0BSD) and the Chakra Petch, Rubik
and Martian Mono fonts (SIL Open Font License 1.1), and runs on Electron; their notices are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), and installers include the Electron and Chromium licenses. The
app ships no third-party images or textures.

PlayStation, PSX, Nintendo 64, NES and Game Boy are trademarks of their respective owners. They are used here only
to describe the look and limits this tool imitates; 4FXELIZER is not affiliated with or endorsed by them.
