// Owns the GPU objects (they don't belong in React state): per open texture its source, stage
// chain (with its cache) and resources (palette buffers, maps); the viewer shows the active one.
// React talks to it through a module-level singleton.

import { initGpu, type Gpu } from '@/gpu/device'
import { PassChain } from '@/gpu/chain'
import { ModelGpu } from '@/gpu/model/modelGpu'
import { DEFAULT_BLEND, PassRunner, WORK_FORMAT, type PassDef } from '@/gpu/pass'
import { PASSES } from '@/gpu/passes'
import { DEFAULT_DOWNSCALE, downscale, type DownscaleParams } from '@/gpu/passes/downscale'
import { DEFAULT_QUANTIZE, type QuantizeParams } from '@/gpu/passes/quantize'
import type { ChainPlan, StageSpec } from '@/gpu/plan'
import { GpuResources } from '@/gpu/resources'
import { readTexelRgba8, readTextureRgba8, uploadBitmap } from '@/gpu/textureIO'
import { ViewerRenderer, type ViewerFrame } from '@/gpu/viewer'
import type { RgbaImage } from '@/image/png'
import type { Bvh } from '@/model/bvh'
import type { ModelData } from '@/model/model'
import type { Palette } from '@/palette/palette'
import type { MapChannel, MapSlot } from '@shared/maps'
import type { OutputLock } from '@/stack/analyze'

export const LOCK_UID = '__output-lock'

export interface ProcessInput {
  stages: StageSpec[]
  palettes: Palette[]
  outputLock: OutputLock
  /** Stage whose output to show; null = final output. */
  previewUid: string | null
  /** Stage whose dither mask to show instead (overrides previewUid); null = none. */
  maskUid?: string | null
  /** Channel read from each loaded map. */
  mapChannels?: Partial<Record<MapSlot, MapChannel>>
}

/** The output palette lock as a trailing Quantize stage (reuses the stage cache). */
export function withOutputLock(stages: StageSpec[], lock: OutputLock): StageSpec[] {
  if (!lock.enabled || !lock.paletteId) return stages
  const params: QuantizeParams = { ...DEFAULT_QUANTIZE, mode: 'palette', paletteId: lock.paletteId }
  return [...stages, { uid: LOCK_UID, passId: 'quantize', params, enabled: true, blend: DEFAULT_BLEND }]
}

type PlanListener = (plan: ChainPlan, sourceKey: string, textureId: string) => void

/** One open texture on the GPU: its pixels, its stage chain and cache, its maps and palettes. */
class TextureSlot {
  readonly resources: GpuResources
  readonly chain: PassChain
  source: { key: string; texture: GPUTexture } | null = null
  output: GPUTexture | null = null
  /** What the viewer shows on the "after" side: the result, a previewed stage or a mask. */
  shown: GPUTexture | null = null
  /** Mask view output, kept outside the stage cache so it never affects the real output. */
  mask: { texture: GPUTexture; free(): void } | null = null
  lastPlan: ChainPlan | null = null

  constructor(
    readonly id: string,
    device: GPUDevice,
    runner: PassRunner
  ) {
    this.resources = new GpuResources(device)
    this.chain = new PassChain(device, runner, PASSES, this.resources)
  }

  textureForKey(key: string): GPUTexture | null {
    if (key === this.source?.key) return this.source.texture
    return this.chain.get(key) ?? null
  }

  dispose(): void {
    this.chain.dispose()
    this.resources.dispose()
    this.source?.texture.destroy()
    this.mask?.texture.destroy()
    this.mask?.free()
  }
}

export class Engine {
  private readonly runner: PassRunner
  private readonly slots = new Map<string, TextureSlot>()
  private activeId: string | null = null
  private viewer: ViewerRenderer | null = null
  private sourceVersion = 0
  private readonly planListeners = new Set<PlanListener>()
  private modelGpu: ModelGpu | null = null

  private constructor(readonly gpu: Gpu) {
    this.runner = new PassRunner(gpu.device)
  }

  /** The active texture's slot (null = none open or not loaded yet). */
  private get active(): TextureSlot | null {
    return (this.activeId && this.slots.get(this.activeId)) || null
  }

  private slotFor(id: string): TextureSlot {
    let slot = this.slots.get(id)
    if (!slot) {
      slot = new TextureSlot(id, this.gpu.device, this.runner)
      this.slots.set(id, slot)
    }
    return slot
  }

  /** Follows the store's texture list: which texture is shown, and which slots can go. */
  syncTextures(ids: readonly string[], activeId: string | null): void {
    for (const [id, slot] of this.slots) {
      if (ids.includes(id)) continue
      if (id === this.activeId) this.viewer?.setTextures(null, null)
      slot.dispose()
      this.slots.delete(id)
    }
    if (activeId !== this.activeId) {
      this.activeId = activeId
      const slot = this.active
      this.viewer?.setTextures(slot?.source?.texture ?? null, slot?.shown ?? null)
    }
  }

  /** The texture a slot currently outputs (the full stack's result, for the 3D view and export). */
  outputOf(id: string): GPUTexture | null {
    return this.slots.get(id)?.output ?? null
  }

  sourceOf(id: string): GPUTexture | null {
    return this.slots.get(id)?.source?.texture ?? null
  }

  static async create(): Promise<Engine> {
    return new Engine(await initGpu(window.fx.settings.gpu === 'low-power' ? 'low-power' : 'high-performance'))
  }

  attachCanvas(canvas: HTMLCanvasElement): ViewerRenderer {
    this.viewer?.dispose()
    this.viewer = new ViewerRenderer(this.gpu.device, canvas)
    this.viewer.setTextures(this.active?.source?.texture ?? null, this.active?.shown ?? null)
    return this.viewer
  }

  detachCanvas(): void {
    this.viewer?.dispose()
    this.viewer = null
  }

  get sourceKey(): string | null {
    return this.active?.source?.key ?? null
  }

  /** The active texture as decoded (null = none). Read it when drawing; it changes on load. */
  get sourceTexture(): GPUTexture | null {
    return this.active?.source?.texture ?? null
  }

  /**
   * What the viewer shows on the "after" side: the result, a previewed stage or a mask. Read it when
   * drawing: process() may replace (and free) it.
   */
  get shownTexture(): GPUTexture | null {
    return this.active?.shown ?? null
  }

  /**
   * A map of a texture (the active one by default; null = none). Read it when drawing; loading a
   * map replaces it.
   */
  mapTexture(slot: MapSlot, textureId?: string): GPUTexture | null {
    const owner = textureId ? this.slots.get(textureId) : this.active
    return owner?.resources.map(slot)?.texture ?? null
  }

  /** The loaded model on the GPU (null = none). */
  get model(): ModelGpu | null {
    return this.modelGpu
  }

  /** Uploads a model (null unloads it). */
  setModel(data: ModelData | null, bvh: Bvh | null): void {
    this.modelGpu?.dispose()
    this.modelGpu = data && bvh ? new ModelGpu(this.gpu.device, data, bvh) : null
  }

  /** New pixels for a texture (created if new). */
  loadBitmap(bitmap: ImageBitmap, textureId: string): void {
    const slot = this.slotFor(textureId)
    const texture = uploadBitmap(this.gpu.device, bitmap)
    const previous = slot.source
    slot.source = { key: `source-${++this.sourceVersion}`, texture }
    slot.output = texture
    slot.shown = texture
    slot.lastPlan = null
    if (slot === this.active) this.viewer?.setTextures(texture, texture)
    previous?.texture.destroy()
  }

  /**
   * Uploads an imported map into a texture's slot (the active texture by default; null clears it);
   * `version` must be new for every image.
   */
  loadMap(slot: MapSlot, bitmap: ImageBitmap | null, version: number, textureId?: string): void {
    // A texture closed meanwhile gets no slot back.
    const owner = textureId ? this.slots.get(textureId) : this.active
    owner?.resources.setMap(slot, bitmap, version)
  }

  /** Puts a texture (a baked map, in the working format) into a map slot; the slot owns it from now on. */
  setMapTexture(slot: MapSlot, texture: GPUTexture, version: number, textureId?: string): void {
    const owner = textureId ? this.slots.get(textureId) : this.active
    if (owner) owner.resources.setMapTexture(slot, texture, version)
    else texture.destroy()
  }

  /** Runs the active texture's stack (only stages whose inputs changed) and points the viewer at the result. */
  process(input: ProcessInput): void {
    const slot = this.active
    if (slot) this.processSlot(slot, input)
  }

  /** Runs a texture's stack without showing it (other textures, for the 3D view and export). */
  processTexture(textureId: string, input: ProcessInput): void {
    const slot = this.slots.get(textureId)
    if (slot) this.processSlot(slot, { ...input, previewUid: null, maskUid: null })
  }

  private processSlot(slot: TextureSlot, input: ProcessInput): void {
    const source = slot.source
    if (!source) return
    slot.resources.syncPalettes(input.palettes)
    slot.resources.setMapChannels(input.mapChannels ?? {})
    const { output, plan } = slot.chain.run(source, withOutputLock(input.stages, input.outputLock))
    slot.output = output
    slot.lastPlan = plan
    const preview = input.previewUid ? plan.stages.find((s) => s.stage.uid === input.previewUid) : undefined
    slot.shown = this.renderMask(slot, plan, input.maskUid ?? null) ?? (preview && slot.textureForKey(preview.outputKey)) ?? output
    if (slot === this.active) this.viewer?.setTextures(source.texture, slot.shown)
    for (const listener of this.planListeners) listener(plan, source.key, slot.id)
  }

  /**
   * Renders a stage's mask into a texture of its own: a pass with its own mask (Dither) runs with
   * `showMask` on its input; any other stage shows its blend mask.
   */
  private renderMask(slot: TextureSlot, plan: ChainPlan, uid: string | null): GPUTexture | null {
    const old = slot.mask
    slot.mask = null
    const planned = uid ? plan.stages.find((s) => s.stage.uid === uid) : undefined
    const input = planned && slot.textureForKey(planned.inputKey)
    const def = planned && PASSES.get(planned.stage.passId)
    if (planned && input && def) {
      const { passId, params, blend } = planned.stage
      const encoder = this.gpu.device.createCommandEncoder({ label: 'mask view' })
      if (def.ownMask) {
        const run = slot.chain.encodeStage(encoder, passId, { ...(params as object), showMask: true }, DEFAULT_BLEND, input, slot.source!.texture, 'mask view')
        this.gpu.device.queue.submit([encoder.finish()])
        run.release()
        slot.mask = { texture: run.texture, free: () => run.uniforms.forEach((u) => u.destroy()) }
      } else {
        const build = slot.chain.encodeBlendMask(encoder, passId, params, blend, input, slot.source!.texture)
        this.gpu.device.queue.submit([encoder.finish()])
        if (build) slot.mask = { texture: build.texture, free: () => build.release() }
      }
    }
    // The viewer must drop the old texture before it's destroyed; process() rebinds right after.
    if (old) {
      if (slot === this.active) this.viewer?.setTextures(slot.source?.texture ?? null, slot.mask?.texture ?? slot.output)
      old.texture.destroy()
      old.free()
    }
    return slot.mask?.texture ?? null
  }

  /** Called after every process() with the plan that ran. */
  onPlan(listener: PlanListener): () => void {
    this.planListeners.add(listener)
    return () => this.planListeners.delete(listener)
  }

  get lastProcessedPlan(): ChainPlan | null {
    return this.active?.lastPlan ?? null
  }

  /** The last plan run for a texture, and its source key. */
  planOf(textureId: string): { plan: ChainPlan | null; sourceKey: string | null } {
    const slot = this.slots.get(textureId)
    return { plan: slot?.lastPlan ?? null, sourceKey: slot?.source?.key ?? null }
  }

  draw(frame: ViewerFrame): void {
    this.viewer?.draw(frame)
  }

  /**
   * The texel the viewer shows at `uv` (0–1 across the image) on one side of the split: the
   * source ('before') or what's shown on the right ('after'). Exact, never filtered.
   */
  async readShownPixel(side: 'before' | 'after', uv: { u: number; v: number }): Promise<[number, number, number, number]> {
    const texture = side === 'before' ? this.active?.source?.texture : this.active?.shown
    if (!texture) throw new Error('No image loaded.')
    const x = Math.min(Math.max(Math.floor(uv.u * texture.width), 0), texture.width - 1)
    const y = Math.min(Math.max(Math.floor(uv.v * texture.height), 0), texture.height - 1)
    return readTexelRgba8(this.gpu.device, texture, x, y)
  }

  /** Final output of a texture (the active one by default; including the output palette lock) as straight RGBA8. */
  async readOutput(textureId?: string): Promise<RgbaImage> {
    const output = textureId ? this.outputOf(textureId) : this.active?.output
    if (!output) throw new Error('Nothing to export yet.')
    return readTextureRgba8(this.gpu.device, output)
  }

  /**
   * Pixels of a cached image (source or a stage's output), nearest-sampled down to at most
   * `maxSide` so palette generation sees exact colors without reading back huge textures.
   */
  async samplePixels(key: string, maxSide = 512, textureId?: string): Promise<RgbaImage> {
    const slot = textureId ? this.slots.get(textureId) : this.active
    const texture = slot?.textureForKey(key)
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
      palette: slot!.resources.emptyPalette,
      paletteCount: 0,
      pattern: slot!.resources.pattern
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
