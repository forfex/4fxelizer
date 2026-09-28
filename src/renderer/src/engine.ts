// Owns the GPU objects (they don't belong in React state): source texture, stage chain,
// palette buffers, viewer. React talks to it through a module-level singleton.

import { initGpu, type Gpu } from '@/gpu/device'
import { PassChain } from '@/gpu/chain'
import { DEFAULT_BLEND, PassRunner, WORK_FORMAT, type PassDef } from '@/gpu/pass'
import { PASSES } from '@/gpu/passes'
import { DEFAULT_DOWNSCALE, downscale, type DownscaleParams } from '@/gpu/passes/downscale'
import { DEFAULT_QUANTIZE, type QuantizeParams } from '@/gpu/passes/quantize'
import type { ChainPlan, StageSpec } from '@/gpu/plan'
import { GpuResources } from '@/gpu/resources'
import { readTextureRgba8, uploadBitmap } from '@/gpu/textureIO'
import { ViewerRenderer, type ViewerFrame } from '@/gpu/viewer'
import type { RgbaImage } from '@/image/png'
import type { Palette } from '@/palette/palette'
import type { OutputLock } from '@/stack/analyze'

export const LOCK_UID = '__output-lock'

export interface ProcessInput {
  stages: StageSpec[]
  palettes: Palette[]
  outputLock: OutputLock
  /** Stage whose output to show; null = final output. */
  previewUid: string | null
}

/** The output palette lock as a trailing Quantize stage (reuses the stage cache). */
export function withOutputLock(stages: StageSpec[], lock: OutputLock): StageSpec[] {
  if (!lock.enabled || !lock.paletteId) return stages
  const params: QuantizeParams = { ...DEFAULT_QUANTIZE, mode: 'palette', paletteId: lock.paletteId }
  return [...stages, { uid: LOCK_UID, passId: 'quantize', params, enabled: true, blend: DEFAULT_BLEND }]
}

type PlanListener = (plan: ChainPlan, sourceKey: string) => void

export class Engine {
  readonly chain: PassChain
  readonly resources: GpuResources
  private readonly runner: PassRunner
  private source: { key: string; texture: GPUTexture } | null = null
  private output: GPUTexture | null = null
  private shown: GPUTexture | null = null
  private viewer: ViewerRenderer | null = null
  private sourceVersion = 0
  private lastPlan: ChainPlan | null = null
  private readonly planListeners = new Set<PlanListener>()

  private constructor(readonly gpu: Gpu) {
    this.runner = new PassRunner(gpu.device)
    this.resources = new GpuResources(gpu.device)
    this.chain = new PassChain(gpu.device, this.runner, PASSES, this.resources)
  }

  static async create(): Promise<Engine> {
    return new Engine(await initGpu())
  }

  attachCanvas(canvas: HTMLCanvasElement): ViewerRenderer {
    this.viewer?.dispose()
    this.viewer = new ViewerRenderer(this.gpu.device, canvas)
    this.viewer.setTextures(this.source?.texture ?? null, this.shown)
    return this.viewer
  }

  detachCanvas(): void {
    this.viewer?.dispose()
    this.viewer = null
  }

  get sourceKey(): string | null {
    return this.source?.key ?? null
  }

  loadBitmap(bitmap: ImageBitmap): void {
    const texture = uploadBitmap(this.gpu.device, bitmap)
    const previous = this.source
    this.source = { key: `source-${++this.sourceVersion}`, texture }
    this.output = texture
    this.shown = texture
    this.lastPlan = null
    this.viewer?.setTextures(texture, texture)
    previous?.texture.destroy()
  }

  /** Runs the stack (only stages whose inputs changed) and points the viewer at the result. */
  process(input: ProcessInput): void {
    if (!this.source) return
    this.resources.syncPalettes(input.palettes)
    const { output, plan } = this.chain.run(this.source, withOutputLock(input.stages, input.outputLock))
    this.output = output
    this.lastPlan = plan
    const preview = input.previewUid ? plan.stages.find((s) => s.stage.uid === input.previewUid) : undefined
    this.shown = (preview && this.textureForKey(preview.outputKey)) || output
    this.viewer?.setTextures(this.source.texture, this.shown)
    for (const listener of this.planListeners) listener(plan, this.source.key)
  }

  /** Called after every process() with the plan that ran. */
  onPlan(listener: PlanListener): () => void {
    this.planListeners.add(listener)
    return () => this.planListeners.delete(listener)
  }

  get lastProcessedPlan(): ChainPlan | null {
    return this.lastPlan
  }

  private textureForKey(key: string): GPUTexture | null {
    if (key === this.source?.key) return this.source.texture
    return this.chain.get(key) ?? null
  }

  draw(frame: ViewerFrame): void {
    this.viewer?.draw(frame)
  }

  /** Final output (including the output palette lock) as straight RGBA8. */
  async readOutput(): Promise<RgbaImage> {
    if (!this.output) throw new Error('Nothing to export yet.')
    return readTextureRgba8(this.gpu.device, this.output)
  }

  /**
   * Pixels of a cached image (source or a stage's output), nearest-sampled down to at most
   * `maxSide` so palette generation sees exact colors without reading back huge textures.
   */
  async samplePixels(key: string, maxSide = 512): Promise<RgbaImage> {
    const texture = this.textureForKey(key)
    if (!texture) throw new Error('That image is not available yet.')
    if (Math.max(texture.width, texture.height) <= maxSide) return readTextureRgba8(this.gpu.device, texture)

    const params: DownscaleParams = { ...DEFAULT_DOWNSCALE, method: 'nearest', sizeMode: 'longest', longest: maxSide }
    const size = downscale.outputSize!(texture, params)
    const small = this.gpu.device.createTexture({
      label: 'palette sample',
      size: [size.width, size.height],
      format: WORK_FORMAT,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC
    })
    const def = downscale as PassDef<never>
    const uniforms = this.runner.createUniforms(downscale, params, DEFAULT_BLEND, 0)
    const encoder = this.gpu.device.createCommandEncoder({ label: 'palette sample' })
    this.runner.encode(encoder, def, texture, small, uniforms, {
      palette: this.resources.emptyPalette,
      paletteCount: 0,
      pattern: this.resources.pattern
    })
    this.gpu.device.queue.submit([encoder.finish()])
    try {
      return await readTextureRgba8(this.gpu.device, small)
    } finally {
      small.destroy()
      for (const u of uniforms) u.destroy()
    }
  }
}

let engine: Engine | null = null
let starting: Promise<Engine> | null = null

/** Creates the engine once (safe to call repeatedly, e.g. from StrictMode double effects). */
export function startEngine(): Promise<Engine> {
  starting ??= Engine.create().then((e) => (engine = e))
  return starting
}

export function getEngine(): Engine | null {
  return engine
}
