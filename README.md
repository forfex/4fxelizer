# 4FXELIZER

PSX-style texture stylizer. See [docs/PLAN.md](docs/PLAN.md) for the full design and roadmap.

## Commands

```bash
npm install          # also downloads the Electron binary (postinstall)
npm run dev          # app with hot reload
npm test             # unit tests (vitest)
npm run typecheck
npm run build        # typecheck + production bundles in out/
npm run dist         # installer for the current OS (dist/)
```

## Verifying WebGPU on a machine

```bash
npm run build
npx electron . --gpu-report
```

This runs headless: it collects adapter info and limits, runs a real
upload → compute → readback test, writes `4fxelizer-gpu-report.json`, and exits 0 on success.
A packaged app accepts the same flag (`4fxelizer --gpu-report=path.json`). In the app,
**Help › GPU Diagnostics…** shows the same report.

On Linux the app adds `--enable-unsafe-webgpu --enable-features=Vulkan`. Launch with
`FXELIZER_NO_GPU_FLAGS=1` to compare against the defaults.

| OS | Status |
|---|---|
| Windows 11 (NVIDIA RTX 5070 Ti, Electron 44 / Chrome 152) | ✅ passes |
| macOS | not yet tested |
| Linux | not yet tested |

## Layout

```
src/main/            Electron main: window, menu, file dialogs, GPU flags, --gpu-report
src/preload/         window.fx bridge (sandboxed, CommonJS)
src/shared/api.ts    IPC contract shared by main, preload and renderer
src/renderer/src/
  gpu/pass.ts        pass framework: each stage = one WGSL compute function
  gpu/plan.ts        stage-cache planning (pure, unit-tested)
  gpu/chain.ts       runs the stage stack on the GPU with per-stage caching
  gpu/viewer.*       2D viewer renderer: zoom, split view, pixel grid, alpha checker
  gpu/passes/        stage implementations (Phase 0: a posterize test pass)
  image/             PNG encoder, TGA decoder, half-float readback
  viewer/viewport.ts zoom/pan math in device pixels
  engine.ts          owns GPU objects; React talks to it
  store.ts           app state (zustand)
  components/ui/     shadcn-style primitives, restyled via tokens
  styles/tokens.css  design tokens: the one place to restyle the app
```

## Notes

- **Vite 7, not 8**: electron-vite 5 supports Vite ≤ 7. Upgrade together when electron-vite 6 is stable.
- **Everything is a devDependency**: the renderer bundles its libraries, and main/preload have
  no runtime deps, so the packaged app ships only `out/`.
- **Adding a stage**: create `gpu/passes/<name>.ts` with `definePass` (a WGSL `run` function,
  a `Params` struct and `pack`), then register it in `gpu/passes/index.ts`.
- **Image values are kept exact**: images decode without color-space conversion or alpha
  premultiplication, stages work in `rgba16float`, and PNG export uses our own encoder
  (canvas encoding would premultiply alpha).
