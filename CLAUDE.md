# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

4FXELIZER is an Electron desktop app that turns high-res textures into PSX-style low-res, palettized, dithered textures. Target users are artists, not programmers. `docs/PLAN.md` holds the full design, visual-style rules and roadmap. The app currently covers the 2D workflow: Adjust, Downscale, Upscale, Quantize and Dither stages, project palettes (generate / edit / import / export) plus per-stage generated palettes (up to 8192 colors), dither masks (from the image or imported maps such as AO), custom dither patterns, presets, undo, a palette eyedropper, a tiling view, and PNG / TGA / BMP export (full color or indexed). It has been verified on Windows only; keep macOS/Linux supported (no platform-specific code paths beyond `src/main/gpuFlags.ts`, menu accelerators, the window icon format (`.ico` on Windows) and the title bar (see below)).

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
- `src/shared/maps.ts` (tested): map slots (AO, cavity, …) and filename detection (`_ao`, `_orm`, …). Main uses it to find a texture's maps next to it (`findMaps`), the renderer to assign dropped files.
- `src/shared/menu.ts` defines the app menu once (`appMenu`). Main builds the native menu from it (keyboard shortcuts everywhere, the real menu bar on macOS); the renderer draws it in the custom title bar (`components/TitleBar.tsx`) on Windows/Linux. Add menu items there, never in only one place. Command items send a `MenuCommand`; role items (clipboard, full screen, quit) are performed by main (`runMenuRole`).
- Title bar: the window uses `titleBarStyle: 'hidden'`. Windows/Linux keep the native window buttons as a `titleBarOverlay`, which the renderer colors from `--fx-titlebar-*` tokens at startup (`setTitleBarOverlay`); the title bar keeps clear of them with the `env(titlebar-area-*)` CSS variables. macOS keeps its traffic lights. Only the title bar's empty parts (icon, area around the title) are drag regions (`-webkit-app-region: drag`); popups and dialogs are `no-drag` globally (`styles/index.css`) because they can overlap it. The in-app menu bar works from the keyboard like a native one (Alt / F10 focus it, Alt+letter opens a menu, Escape hands focus back), and remembers the focused element on pointer down so clipboard roles reach it. Never layer a drag region over something clickable, not even a `pointer-events: none` overlay: Windows hit-tests drag regions before the page gets the click, so the control silently stops working with a real mouse (automated clicks don't go through that hit test and still pass).
- `src/main/`: window, native menu (menu items send `MenuCommand`s to the renderer), file dialogs, GPU flags, `--gpu-report` mode. The window uses `sandbox: true` + `contextIsolation`, so the preload **must build as CommonJS** (`.cjs`, configured in `electron.vite.config.ts`).
- `src/renderer/src/`: React UI plus all image processing, done on the GPU.

Path aliases: `@shared` → `src/shared`, `@` → `src/renderer/src`. They are defined in both `electron.vite.config.ts` and `vitest.config.ts`.

### Renderer data flow

- `store.ts` (zustand) holds UI state. The undoable **document** (`stack/doc.ts`: `stages`, `palettes`, `outputLock`) changes only through `edit()` (or the helpers built on it) so it lands in undo history. Pure document operations live in `stack/doc.ts` (tested): a Quantize/Dither stage can own a palette (`palette.ownerUid`) generated from its own input; `makeStage`, `duplicateStage`, `removeStage`, `toGeneratedPalette` / `toProjectPalette` keep owned palettes consistent with their stages. `coalesce` merges rapid edits (slider drags) into one step; `silent` skips history (derived updates such as auto-generated palette colors). GPU objects never go in React state.
- `engine.ts` is a module-level singleton (`startEngine()` / `getEngine()`) that owns the GPU device, the source texture, `GpuResources` (palette buffers, blue noise), the `PassChain` and the `ViewerRenderer`. The output palette lock runs as a trailing Quantize stage (`withOutputLock`). `onPlan` listeners run after every stack run.
- `palette/controller.ts` regenerates palettes with `generator.auto` when the image they come from (the source, or a stage's input cache key) or their settings change. Generation runs in a worker (`palette/palette.worker.ts`).
- `actions.ts` connects UI and engine: file load, export, palette import/export, undo/redo, `runMenuCommand`.
- `components/Viewer.tsx` runs the frame loop. It calls `engine.process(...)` when the image, stages, palettes, output lock, previewed stage, mask view or maps change, and `engine.draw(...)` each frame. The tiling view draws 3×3 copies (`TILES`); the view stays anchored to the middle copy and `pixelAt` / `uvAt` wrap back onto the image. Processing is rAF-driven, so it pauses while the window is hidden or minimized. The split divider is stored as a fraction of the image width (`splitPos`), so it moves with pans and zooms (`splitScreenX` / `splitPosAt` in `viewer/viewport.ts`).
- `stack/analyze.ts` (pure, tested) computes per-stage sizes and the order warnings shown on stage cards.
- Imported maps live in the store (`maps`, not undoable, not in presets: they belong to the texture) and on the GPU (`GpuResources.setMap`); loading a texture clears them and loads its siblings. Stages refer to maps by slot (`map-ao` mask sources), so presets work with any texture set.
- Presets (`stack/preset.ts`, tested) serialize the document as `.4fxpreset` JSON. Parsing validates, fills defaults, drops unknown stages and remaps every stage/palette id and reference. User presets are files in `<userData>/presets` handled by `src/main/presets.ts` (file names validated there); built-ins are in `stack/builtinPresets.ts`. Keep old presets loading when params change: add defaults, never repurpose a field.
- User settings (`UserSettings` / `normalizeSettings` in `@shared/api`, tested) live in `<userData>/settings.json`, owned by `src/main/settings.ts` (also window placement). The preload reads them synchronously (`window.fx.settings`) so the first render uses them; `renderer/src/settings.ts` applies them to the store and saves changes. Add a field with a default in `normalizeSettings`; old files keep working.
- The panel layout is dockview (`dockview-react`), set up in `components/Workspace.tsx` and `workspace/workspace.ts`: the viewer plus tool panels (`PANELS`) that dock, tab, float and resize. Built-in workspaces are built through the dockview API (not stored JSON). The current layout, the active workspace and the user's saved workspaces live in `UserSettings` (`layout`, `workspace`, `workspaces`); a layout that fails to load falls back to a built-in workspace. Stored layouts are checked by `workspace/layoutCheck.ts` (tested) before `fromJSON`, because dockview doesn't validate component names and an unknown one would only fail at render; the dock also sits in an `ErrorBoundary` with a layout reset. Keep panel ids stable, or old layouts fall back to the default. The viewer stays mounted when switching built-in workspaces (`clearTools`), and a pending layout save is flushed on `beforeunload` (main flushes settings on `will-quit`). The dock theme (`styles/dock.css`) maps dockview's `--dv-*` variables onto `--fx-*` tokens, and the dock sits in an `isolate` container so its high z-indexes stay below menus and dialogs. Adding a panel: a component rendering `PanelBody`, an entry in `PANELS` and in `COMPONENTS`, and a place in the built-in workspaces.
- Dev builds expose `window.__fx = { useApp, getEngine }` for DevTools and automation.

### GPU pipeline (`src/renderer/src/gpu/`)

- `pass.ts`: each stage is one WGSL compute pass. A pass supplies only `fn run(p: vec2u, size: vec2u) -> vec4f`, plus an optional `struct Params` with a matching `pack()` (16-byte aligned; `packStruct` mixes f32/u32), an optional `outputSize(input, params, { source })` and an optional `resources()` (the palette id it reads). The framework wraps it with bindings (`src`, `dst`, `params`, `linearSampler`, `palette`, `pattern`, `stage`, `scratch`, `maskTex`, `customPattern`), the WGSL helpers in `wgslLib.ts` (OKLab, palette lookup, Bayer/blue-noise thresholds, `inputAt`, blend modes) and the per-stage blend (opacity + mode over the stage's input). The working format between stages is `rgba16float`.
- Serial passes (error diffusion in `passes/dither.ts`): a pass may also define `fn runRows(thread, size)`, run as one workgroup of `ROW_THREADS` when `serial(params)` is true, writing texels through `emit()`. It gets zeroed `scratch` storage sized by `scratchBytes()` (allocated per run, freed after submit). Dither processes rows as a wavefront, each row a few columns behind the one above, so results equal a plain sequential scan. Serpentine and wrap-around need the whole row above first, so they run row by row on one thread (wrap-around warms up with the last rows so their error flows into the top).
- Masks (`mask.ts`): a pass declares `mask(params) → MaskSpec | null`; before it runs, the chain builds the mask into a texture (up to two sources from the stage input or imported maps, invert, combine, separable Gaussian blur, optional wrap) and binds it as `maskTex`, read with `maskAt(p, size)` (1 = full effect; a white 1×1 when there's none). Map sources are sampled in UV. `resources()` lists the map slots read, so their signatures are part of the cache key.
- Custom dither patterns (`dither/customPattern.ts`, tested) are stored in the params as a `"WxH:base64"` gray string and bound as `customPattern` (r32float rank thresholds, cached per string in `GpuResources`).
- Mask view: `engine.process({ maskUid })` runs that stage once more with `showMask: true` into a texture outside the stage cache (`PassChain.encodeStage`), so it never changes the real output, export or palette generation.
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
- Sliders and dropdowns (`Select`) respond to the mouse wheel only once **armed** (pointer rested 1 s without scrolling, or the control was pressed), shown by an accent outline; otherwise the wheel scrolls the panel. The logic is `lib/useWheelArming.ts`; use it for any new value control. `ParamSlider scale="log"` for wide ranges. Slider math is in `lib/sliderMath.ts` (tested).
- Custom Tailwind utilities (`border-px`, `outline-px`, `bevel-*`) that overlap a Tailwind class group must be registered in `lib/utils.ts` (tailwind-merge), or `cn()` drops them as conflicts.
- `lib/pixelSnap.ts` sets `--px` to a whole number of device pixels, so bevels and borders stay crisp at 125%/150% scaling. Use `var(--px)` for line widths. The GPU viewer reads theme colors through `cssColor(token)`.

## Conventions

- Commits use Conventional Commits (`feat:`, `fix:`, `chore:`, …).
- Never mention roadmap phases ("Phase 1", "Phase 2", …) in code, comments, commit messages, branch names or user-facing docs. Phases exist only in the roadmap in `docs/PLAN.md`; describe the feature itself instead.
