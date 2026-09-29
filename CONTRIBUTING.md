# Contributing to 4FXELIZER

Bug reports and ideas are welcome in [Issues](https://github.com/forfex/4fxelizer/issues). For GPU problems, attach
the report from **Help › GPU Diagnostics…** (or `4fxelizer --gpu-report=report.json`).

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

### Checking WebGPU on a machine

```bash
npm run build
npx electron . --gpu-report
```

This runs headless: it collects adapter info and limits, runs a real upload → compute → readback test, writes
`4fxelizer-gpu-report.json` and exits 0 on success. A packaged app accepts the same flag
(`4fxelizer --gpu-report=path.json`).

On Linux the app adds `--enable-unsafe-webgpu`. Launch with `FXELIZER_NO_GPU_FLAGS=1` to compare against the
defaults. (It used to add `--enable-features=Vulkan` too, which crashed the GPU process under Wayland.) For testing
on a machine without a real GPU, see [Troubleshooting › Linux](guide/troubleshooting.md#linux).

## Project layout

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

[CLAUDE.md](CLAUDE.md) describes the architecture in more depth.

## Notes

- **Adding a stage**: create `gpu/passes/<name>.ts` with `definePass` (a WGSL `run` function, a `Params` struct and
  `pack`), register it in `gpu/passes/index.ts` (`PASSES` + `STAGE_TYPES`), and add its settings editor in
  `components/stages/editors.tsx`.
- **Image values are kept exact**: images decode without color-space conversion or alpha premultiplication, stages
  work in `rgba16float`, and PNG export uses our own encoder (canvas encoding would premultiply alpha).
- **Everything is a devDependency**: the renderer bundles its libraries and main/preload have no runtime deps, so
  the packaged app ships only `out/`.
- **Vite 7, not 8**: electron-vite 5 supports Vite ≤ 7. Upgrade the two together.
- **Styling is token-driven**: `styles/tokens.css` is the one place to restyle; don't hard-code colors or sizes.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, …).

## CI and releases

`.github/workflows/ci.yml` runs on every push and pull request, on Windows, macOS and Linux: typecheck, unit tests,
bundle, a headless launch of the app (`scripts/gpu-smoke.mjs`, which uses `--gpu-report`) and an unpacked package
build. The launch must succeed; missing WebGPU only warns, because hosted runners have no GPU (each run uploads the
GPU report as an artifact).

`.github/workflows/release.yml` builds the installers (Windows NSIS, macOS dmg for x64 and arm64, Linux AppImage
and deb) and publishes a GitHub release when a `v*` tag is pushed. Bump `version` in `package.json` first; the tag
must match it:

```bash
git tag v1.0.0
git push origin v1.0.0
```

## Website

The landing page lives in `site/` and is deployed to GitHub Pages by `.github/workflows/pages.yml` on pushes to
`master` that touch it. One-time setup: **Settings › Pages › Source: GitHub Actions**.

`THIRD_PARTY_NOTICES.md` is regenerated with `node scripts/third-party-notices.mjs` after dependency changes.
