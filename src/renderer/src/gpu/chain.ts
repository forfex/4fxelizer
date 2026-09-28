import { MaskBuilder } from './mask'
import { WORK_FORMAT, type PassDef, type PassRunner, type Size, type StageBlend } from './pass'
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

/** One encoded stage run: its output, the uniforms it keeps, and what to free once submitted. */
export interface EncodedStage {
  texture: GPUTexture
  uniforms: GPUBuffer[]
  release(): void
}

/** Runs a stage stack on the GPU, caching each stage's output (see plan.ts). */
export class PassChain {
  private readonly cache = new Map<string, CacheEntry>()
  private readonly masks: MaskBuilder

  constructor(
    private readonly device: GPUDevice,
    private readonly runner: PassRunner,
    private readonly passes: ReadonlyMap<string, PassDef<never>>,
    private readonly resources: GpuResources
  ) {
    this.masks = new MaskBuilder(device)
  }

  def(passId: string): PassDef<unknown> {
    const def = this.passes.get(passId) as PassDef<unknown> | undefined
    if (!def) throw new Error(`Unknown pass "${passId}"`)
    return def
  }

  /** Signature of the resources a stage reads; part of its cache key. */
  private depsKey = (stage: StageSpec): string => {
    const res = this.def(stage.passId).resources?.(stage.params)
    const parts: string[] = []
    if (res?.palette) parts.push(`pal:${this.resources.palette(res.palette)?.signature ?? 'missing'}`)
    for (const slot of res?.maps ?? []) parts.push(`map-${slot}:${this.resources.map(slot)?.signature ?? 'missing'}`)
    return parts.join('|')
  }

  /**
   * Encodes one run of a stage (its mask first, if it has one) into a new texture. `label` names
   * the output texture.
   */
  encodeStage(
    encoder: GPUCommandEncoder,
    passId: string,
    params: unknown,
    blend: StageBlend,
    input: GPUTexture,
    source: Size,
    label?: string
  ): EncodedStage {
    const def = this.def(passId)
    const size = def.outputSize?.(input, params, { source }) ?? { width: input.width, height: input.height }
    const texture = this.device.createTexture({
      label: label ?? `${def.id} output`,
      size: [Math.max(1, size.width), Math.max(1, size.height)],
      format: WORK_FORMAT,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC
    })
    const palette = this.resources.palette(def.resources?.(params).palette)
    const uniforms = this.runner.createUniforms(def, params, blend, palette?.count ?? 0)
    const scratch = this.runner.createScratch(def, params, texture)
    const maskSpec = def.mask?.(params)
    const mask = maskSpec ? this.masks.encode(encoder, input, texture, maskSpec, (slot) => this.resources.map(slot)) : null
    this.runner.encode(encoder, def as PassDef<never>, input, texture, uniforms, {
      palette: palette?.buffer ?? this.resources.emptyPalette,
      paletteCount: palette?.count ?? 0,
      pattern: this.resources.pattern,
      serial: def.serial?.(params) ?? false,
      scratch,
      mask: mask?.texture
    })
    return {
      texture,
      uniforms,
      release: () => {
        scratch?.destroy()
        mask?.release()
      }
    }
  }

  run(source: ChainSource, stages: StageSpec[]): ChainResult {
    const plan = planChain(source.key, stages, (key) => this.cache.has(key), this.depsKey)
    const textureFor = (key: string): GPUTexture =>
      key === source.key ? source.texture : this.cache.get(key)!.texture

    const encoder = this.device.createCommandEncoder({ label: 'chain' })
    const temporary: (() => void)[] = []
    let ran = 0
    for (const planned of plan.stages) {
      if (!planned.run) continue
      const { stage } = planned
      const run = this.encodeStage(encoder, stage.passId, stage.params, stage.blend, textureFor(planned.inputKey), source.texture)
      temporary.push(run.release)
      this.cache.set(planned.outputKey, { texture: run.texture, uniforms: run.uniforms })
      ran++
    }
    this.device.queue.submit([encoder.finish()])
    for (const release of temporary) release() // freed once the submitted work finishes

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
    this.masks.dispose()
  }
}
