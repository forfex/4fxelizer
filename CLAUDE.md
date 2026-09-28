# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

4FXELIZER is an Electron desktop app that turns high-res textures into PSX-style low-res, palettized, dithered textures. Target users are artists, not programmers. `docs/PLAN.md` holds the full design, visual-style rules and roadmap. The project is currently at Phase 0 (foundation); the only stage is a test `posterize` pass.

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

- `store.ts` (zustand) holds UI state: the `stages: StageSpec[]` stack, viewport, grid/split toggles, and messages. GPU objects never go in React state.
- `engine.ts` is a module-level singleton (`startEngine()` / `getEngine()`) that owns the GPU device, the source texture, the `PassChain` and the `ViewerRenderer`.
- `actions.ts` connects them: file load/export and `runMenuCommand`.
- `components/Viewer.tsx` runs the frame loop. It calls `engine.process(stages)` when the stage array or image version changes, and `engine.draw(...)` each frame.

### GPU pipeline (`src/renderer/src/gpu/`)

- `pass.ts`: each stage is one WGSL compute pass. A pass supplies only `fn run(p: vec2u, size: vec2u) -> vec4f`, plus an optional `struct Params` with a matching `pack()` (16-byte aligned) and an optional `outputSize()`. The framework wraps it with bindings (`src`, `dst`, `params`, `linearSampler`) and the dispatch. The working format between stages is `rgba16float`.
- `plan.ts`: pure, unit-tested cache planning. Each stage's output key hashes the upstream key plus `passId` and the stable-stringified params. So a params change re-runs only that stage and those after it, and reordering needs no explicit invalidation. Disabled stages pass their input key through.
- `chain.ts`: runs the plan on the GPU and frees cache entries that aren't in `liveKeys`.
- **Adding a stage**: create `gpu/passes/<name>.ts` with `definePass(...)` and register it in `gpu/passes/index.ts`.

### Invariants

- **Image values stay exact**: images decode without color-space conversion or alpha premultiplication. PNG export uses our own encoder (`image/png.ts`), because canvas encoding premultiplies alpha. TGA decoding is also custom (`image/tga.ts`).
- Viewport math (`viewer/viewport.ts`) is in **device pixels**.
- The stage stack must stay user-reorderable, and stages must not assume what ran before them (see "Stage model" in docs/PLAN.md).
- Everything in `package.json` is a devDependency on purpose: the renderer bundles its libraries, main/preload have no runtime deps, and the packaged app ships only `out/`.
- Stay on Vite 7: electron-vite 5 supports only Vite ≤ 7, so upgrade the two together.
- No native Node modules. The app must build and run identically on Windows, macOS and Linux. CPU-heavy work goes in Web Workers, or Rust→WASM if profiling shows it's needed.

## UI and styling

- The user designs the UI (in Figma) and Claude implements it. Keep all styling token-driven: `styles/tokens.css` (`--fx-*` variables) is the single place to restyle, and Figma variables map 1:1 onto it. Don't hard-code colors or sizes in components.
- `components/ui/` holds shadcn-style primitives (Radix for behavior) restyled into a retro late-90s / PS1-era look: hard bevels, sunken wells, LCD readouts, small corners. It is **not** pixel-art: fonts stay readable and retro accents are used sparingly.
- `lib/pixelSnap.ts` sets `--px` to a whole number of device pixels, so bevels and borders stay crisp at 125%/150% scaling. Use `var(--px)` for line widths. The GPU viewer reads theme colors through `cssColor(token)`.

## Conventions

- Commits use Conventional Commits (`feat:`, `fix:`, `chore:`, …).
