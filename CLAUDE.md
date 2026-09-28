# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

4FXELIZER is an Electron desktop app that turns high-res textures into PSX-style low-res, palettized, dithered textures. Target users are artists, not programmers. `docs/PLAN.md` holds the full design, visual-style rules and roadmap. The project is at Phase 1 (2D core): Adjust, Downscale, Quantize and Dither stages, project palettes (generate / edit / import / export) plus per-stage generated palettes (up to 8192 colors), presets, undo, and PNG + indexed PNG export. Phase 1 has been verified on Windows only; keep macOS/Linux supported (no platform-specific code paths beyond `src/main/gpuFlags.ts` and menu accelerators).

## Commands

```bash
npm run dev          # app with hot reload
npm test             # vitest, all src/**/*.test.ts (node environment, no GPU)
npx vitest run src/renderer/src/gpu/plan.test.ts   # single test file
npx vitest run -t "name"                           # tests matching a name
npm run typecheck    # runs tsc for three projects: node (main/preload), web (renderer), test
npm run build        # typecheck + bundles into out/
npm run dist         # installer for the current OS (dist:win / dist:mac / dist:linux)
```

WebGPU check on a machine: `npm run build`, then `npx electron . --gpu-report`. It runs headless (upload → compute → readback smoke test), writes `4fxelizer-gpu-report.json` and exits 0 on success. `FXELIZER_NO_GPU_FLAGS=1` disables the Linux WebGPU/Vulkan switches in `src/main/gpuFlags.ts`.

## Architecture

Three Electron processes share one IPC contract:

- `src/shared/api.ts`: the `FxApi` interface (exposed as `window.fx`), the `IPC` channel names and `MenuCommand`. Change the contract here first, then update main (`ipcMain.handle`) and preload.
- `src/main/`: window, native menu (menu items send `MenuCommand`s to the renderer), file dialogs, GPU flags, `--gpu-report` mode. The window uses `sandbox: true` + `contextIsolation`, so the preload **must build as CommonJS** (`.cjs`, configured in `electron.vite.config.ts`).
- `src/renderer/src/`: React UI plus all image processing, done on the GPU.

Path aliases: `@shared` → `src/shared`, `@` → `src/renderer/src`. They are defined in both `electron.vite.config.ts` and `vitest.config.ts`.

### Renderer data flow

- `store.ts` (zustand) holds UI state. The undoable **document** (`stack/doc.ts`: `stages`, `palettes`, `outputLock`) changes only through `edit()` (or the helpers built on it) so it lands in undo history. Pure document operations live in `stack/doc.ts` (tested): a Quantize/Dither stage can own a palette (`palette.ownerUid`) generated from its own input; `makeStage`, `duplicateStage`, `removeStage`, `toGeneratedPalette` / `toProjectPalette` keep owned palettes consistent with their stages. `coalesce` merges rapid edits (slider drags) into one step; `silent` skips history (derived updates such as auto-generated palette colors). GPU objects never go in React state.
- `engine.ts` is a module-level singleton (`startEngine()` / `getEngine()`) that owns the GPU device, the source texture, `GpuResources` (palette buffers, blue noise), the `PassChain` and the `ViewerRenderer`. The output palette lock runs as a trailing Quantize stage (`withOutputLock`). `onPlan` listeners run after every stack run.
- `palette/controller.ts` regenerates palettes with `generator.auto` when the image they come from (the source, or a stage's input cache key) or their settings change. Generation runs in a worker (`palette/palette.worker.ts`).
- `actions.ts` connects UI and engine: file load, export, palette import/export, undo/redo, `runMenuCommand`.
- `components/Viewer.tsx` runs the frame loop. It calls `engine.process(...)` when the image, stages, palettes, output lock or previewed stage change, and `engine.draw(...)` each frame. Processing is rAF-driven, so it pauses while the window is hidden or minimized.
- `stack/analyze.ts` (pure, tested) computes per-stage sizes and the order warnings shown on stage cards.
- Presets (`stack/preset.ts`, tested) serialize the document as `.4fxpreset` JSON. Parsing validates, fills defaults, drops unknown stages and remaps every stage/palette id and reference. User presets are files in `<userData>/presets` handled by `src/main/presets.ts` (file names validated there); built-ins are in `stack/builtinPresets.ts`. Keep old presets loading when params change: add defaults, never repurpose a field.
- Dev builds expose `window.__fx = { useApp, getEngine }` for DevTools and automation.

### GPU pipeline (`src/renderer/src/gpu/`)

- `pass.ts`: each stage is one WGSL compute pass. A pass supplies only `fn run(p: vec2u, size: vec2u) -> vec4f`, plus an optional `struct Params` with a matching `pack()` (16-byte aligned; `packStruct` mixes f32/u32), an optional `outputSize()` and an optional `resources()` (the palette id it reads). The framework wraps it with bindings (`src`, `dst`, `params`, `linearSampler`, `palette`, `pattern`, `stage`), the WGSL helpers in `wgslLib.ts` (OKLab, palette lookup, Bayer/blue-noise thresholds, `inputAt`, blend modes) and the per-stage blend (opacity + mode over the stage's input). The working format between stages is `rgba16float`.
- Palette buffers (`resources.ts`) hold every color twice, sorted by OKLab lightness and by (r+g+b)/√3, with the sort key in `lab.w`. The WGSL lookups binary-search that key and stop once its squared difference exceeds the best distance (exact, fast for thousands of colors). Shader palette indices are therefore buffer positions, not palette order. The CPU k-means uses the same idea (`CenterIndex` in `palette/generate.ts`).
- `plan.ts`: pure, unit-tested cache planning. Each stage's output key hashes the upstream key plus `passId`, the stable-stringified params, the blend, and a signature of the resources it reads (palette colors). So a params or palette change re-runs only the affected stages and those after them, and reordering needs no explicit invalidation. Disabled stages pass their input key through.
- `chain.ts`: runs the plan on the GPU and frees cache entries that aren't in `liveKeys`.
- **Adding a stage**: create `gpu/passes/<name>.ts` with `definePass(...)` and default params, register it in `PASSES` and `STAGE_TYPES` in `gpu/passes/index.ts`, add its editor to `components/stages/editors.tsx`, and teach `stack/analyze.ts` whether it snaps colors or creates new ones.
- Stage params hold palette **ids**, never colors. Palettes live in the store and are uploaded by `GpuResources.syncPalettes`.

### Invariants

- **Image values stay exact**: images decode without color-space conversion or alpha premultiplication. PNG export uses our own encoder (`image/png.ts`, RGBA and indexed), because canvas encoding premultiplies alpha. TGA decoding is also custom (`image/tga.ts`). Indexed export (`image/indexed.ts`) puts all fully transparent pixels at index 0 and keeps a chosen palette's order.
- Color math is duplicated on purpose: `color/oklab.ts` (CPU) and `gpu/wgslLib.ts` (GPU) must stay in sync.
- Viewport math (`viewer/viewport.ts`) is in **device pixels**.
- The stage stack must stay user-reorderable, and stages must not assume what ran before them (see "Stage model" in docs/PLAN.md).
- Everything in `package.json` is a devDependency on purpose: the renderer bundles its libraries, main/preload have no runtime deps, and the packaged app ships only `out/`.
- Stay on Vite 7: electron-vite 5 supports only Vite ≤ 7, so upgrade the two together.
- No native Node modules. The app must build and run identically on Windows, macOS and Linux. CPU-heavy work goes in Web Workers, or Rust→WASM if profiling shows it's needed.

## UI and styling

- The user designs the UI (in Figma) and Claude implements it. Keep all styling token-driven: `styles/tokens.css` (`--fx-*` variables) is the single place to restyle, and Figma variables map 1:1 onto it. Don't hard-code colors or sizes in components.
- `components/ui/` holds shadcn-style primitives (Radix for behavior) restyled into a retro late-90s / PS1-era look: hard bevels, sunken wells, LCD readouts, small corners. It is **not** pixel-art: fonts stay readable and retro accents are used sparingly. Besides button/dialog/slider/retro there are `select.tsx`, `menu.tsx` (dropdown) and `controls.tsx` (NumberField, ParamSlider, Field, Checkbox, Segmented).
- Sliders respond to the mouse wheel only once **armed** (pointer rested 1 s without scrolling, or the slider was pressed), shown by an accent outline on the thumb; otherwise the wheel scrolls the panel. `ParamSlider scale="log"` for wide ranges. Slider math is in `lib/sliderMath.ts` (tested).
- Custom Tailwind utilities (`border-px`, `outline-px`, `bevel-*`) that overlap a Tailwind class group must be registered in `lib/utils.ts` (tailwind-merge), or `cn()` drops them as conflicts.
- `lib/pixelSnap.ts` sets `--px` to a whole number of device pixels, so bevels and borders stay crisp at 125%/150% scaling. Use `var(--px)` for line widths. The GPU viewer reads theme colors through `cssColor(token)`.

## Conventions

- Commits use Conventional Commits (`feat:`, `fix:`, `chore:`, …).
