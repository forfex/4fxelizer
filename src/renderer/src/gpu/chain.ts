import { WORK_FORMAT, type PassDef, type PassRunner } from './pass'
import { planChain, type StageSpec } from './plan'

interface CacheEntry {
  texture: GPUTexture
  uniform: GPUBuffer
}

export interface ChainSource {
  /** Changes whenever the source pixels change. */
  key: string
  texture: GPUTexture
}

export interface ChainResult {
  output: GPUTexture
  outputKey: string
  /** Number of stages that actually ran (0 = everything came from cache). */
  ran: number
}

/** Runs a stage stack on the GPU, caching each stage's output (see plan.ts). */
export class PassChain {
  private readonly cache = new Map<string, CacheEntry>()

  constructor(
    private readonly device: GPUDevice,
    private readonly runner: PassRunner,
    private readonly passes: ReadonlyMap<string, PassDef<never>>
  ) {}

  run(source: ChainSource, stages: StageSpec[]): ChainResult {
    const plan = planChain(source.key, stages, (key) => this.cache.has(key))
    const textureFor = (key: string): GPUTexture =>
      key === source.key ? source.texture : this.cache.get(key)!.texture

    const encoder = this.device.createCommandEncoder({ label: 'chain' })
    let ran = 0
    for (const planned of plan.stages) {
      if (!planned.run) continue
      const def = this.passes.get(planned.stage.passId) as PassDef<unknown> | undefined
      if (!def) throw new Error(`Unknown pass "${planned.stage.passId}"`)
      const input = textureFor(planned.inputKey)
      const size = def.outputSize?.(input, planned.stage.params) ?? { width: input.width, height: input.height }
      const texture = this.device.createTexture({
        label: `${def.id} output`,
        size: [size.width, size.height],
        format: WORK_FORMAT,
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC
      })
      const uniform = this.runner.createUniform(def, planned.stage.params)
      this.runner.encode(encoder, def as PassDef<never>, input, texture, uniform)
      this.cache.set(planned.outputKey, { texture, uniform })
      ran++
    }
    this.device.queue.submit([encoder.finish()])

    // Release outputs no longer reachable from the current stack. WebGPU keeps
    // destroyed resources alive until already-submitted work that uses them finishes.
    for (const [key, entry] of this.cache) {
      if (!plan.liveKeys.has(key)) {
        entry.texture.destroy()
        entry.uniform.destroy()
        this.cache.delete(key)
      }
    }

    return { output: textureFor(plan.outputKey), outputKey: plan.outputKey, ran }
  }

  /** Cached output for a key, e.g. for preview-at-stage. */
  get(key: string): GPUTexture | undefined {
    return this.cache.get(key)?.texture
  }

  dispose(): void {
    for (const entry of this.cache.values()) {
      entry.texture.destroy()
      entry.uniform.destroy()
    }
    this.cache.clear()
  }
}
