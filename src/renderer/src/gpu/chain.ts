import { WORK_FORMAT, type PassDef, type PassRunner } from './pass'
import { planChain, type ChainPlan, type StageSpec } from './plan'
import type { GpuResources } from './resources'

interface CacheEntry {
  texture: GPUTexture
  uniforms: GPUBuffer[]
}

export interface ChainSource {
  /** Changes whenever the source pixels change. */
  key: string
  texture: GPUTexture
}

export interface ChainResult {
  output: GPUTexture
  outputKey: string
  plan: ChainPlan
  /** Number of stages that actually ran (0 = everything came from cache). */
  ran: number
}

/** Runs a stage stack on the GPU, caching each stage's output (see plan.ts). */
export class PassChain {
  private readonly cache = new Map<string, CacheEntry>()

  constructor(
    private readonly device: GPUDevice,
    private readonly runner: PassRunner,
    private readonly passes: ReadonlyMap<string, PassDef<never>>,
    private readonly resources: GpuResources
  ) {}

  private def(stage: StageSpec): PassDef<unknown> {
    const def = this.passes.get(stage.passId) as PassDef<unknown> | undefined
    if (!def) throw new Error(`Unknown pass "${stage.passId}"`)
    return def
  }

  /** Signature of the resources a stage reads; part of its cache key. */
  private depsKey = (stage: StageSpec): string => {
    const res = this.def(stage).resources?.(stage.params)
    if (!res?.palette) return ''
    return `pal:${this.resources.palette(res.palette)?.signature ?? 'missing'}`
  }

  run(source: ChainSource, stages: StageSpec[]): ChainResult {
    const plan = planChain(source.key, stages, (key) => this.cache.has(key), this.depsKey)
    const textureFor = (key: string): GPUTexture =>
      key === source.key ? source.texture : this.cache.get(key)!.texture

    const encoder = this.device.createCommandEncoder({ label: 'chain' })
    const scratch: GPUBuffer[] = []
    let ran = 0
    for (const planned of plan.stages) {
      if (!planned.run) continue
      const { stage } = planned
      const def = this.def(stage)
      const input = textureFor(planned.inputKey)
      const size = def.outputSize?.(input, stage.params, { source: source.texture }) ?? { width: input.width, height: input.height }
      const texture = this.device.createTexture({
        label: `${def.id} output`,
        size: [Math.max(1, size.width), Math.max(1, size.height)],
        format: WORK_FORMAT,
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC
      })
      const palette = this.resources.palette(def.resources?.(stage.params).palette)
      const uniforms = this.runner.createUniforms(def, stage.params, stage.blend, palette?.count ?? 0)
      const buffer = this.runner.createScratch(def, stage.params, texture)
      if (buffer) scratch.push(buffer)
      this.runner.encode(encoder, def as PassDef<never>, input, texture, uniforms, {
        palette: palette?.buffer ?? this.resources.emptyPalette,
        paletteCount: palette?.count ?? 0,
        pattern: this.resources.pattern,
        serial: def.serial?.(stage.params) ?? false,
        scratch: buffer
      })
      this.cache.set(planned.outputKey, { texture, uniforms })
      ran++
    }
    this.device.queue.submit([encoder.finish()])
    for (const buffer of scratch) buffer.destroy() // released once the submitted work finishes

    // Release outputs no longer reachable from the current stack. WebGPU keeps
    // destroyed resources alive until already-submitted work that uses them finishes.
    for (const [key, entry] of this.cache) {
      if (!plan.liveKeys.has(key)) {
        entry.texture.destroy()
        for (const u of entry.uniforms) u.destroy()
        this.cache.delete(key)
      }
    }

    return { output: textureFor(plan.outputKey), outputKey: plan.outputKey, plan, ran }
  }

  /** Cached output for a key, e.g. for preview-at-stage. */
  get(key: string): GPUTexture | undefined {
    return this.cache.get(key)?.texture
  }

  dispose(): void {
    for (const entry of this.cache.values()) {
      entry.texture.destroy()
      for (const u of entry.uniforms) u.destroy()
    }
    this.cache.clear()
  }
}
