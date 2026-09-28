// Owns the GPU objects (they don't belong in React state): source texture, stage chain,
// viewer. React talks to it through a module-level singleton.

import { encodePng } from '@/image/png'
import { initGpu, type Gpu } from '@/gpu/device'
import { PassChain } from '@/gpu/chain'
import { PassRunner } from '@/gpu/pass'
import { PASSES } from '@/gpu/passes'
import type { StageSpec } from '@/gpu/plan'
import { readTextureRgba8, uploadBitmap } from '@/gpu/textureIO'
import { ViewerRenderer, type ViewerFrame } from '@/gpu/viewer'

export class Engine {
  readonly chain: PassChain
  private source: { key: string; texture: GPUTexture } | null = null
  private output: GPUTexture | null = null
  private viewer: ViewerRenderer | null = null
  private sourceVersion = 0

  private constructor(readonly gpu: Gpu) {
    this.chain = new PassChain(gpu.device, new PassRunner(gpu.device), PASSES)
  }

  static async create(): Promise<Engine> {
    return new Engine(await initGpu())
  }

  attachCanvas(canvas: HTMLCanvasElement): ViewerRenderer {
    this.viewer?.dispose()
    this.viewer = new ViewerRenderer(this.gpu.device, canvas)
    this.viewer.setTextures(this.source?.texture ?? null, this.output)
    return this.viewer
  }

  detachCanvas(): void {
    this.viewer?.dispose()
    this.viewer = null
  }

  loadBitmap(bitmap: ImageBitmap): void {
    const texture = uploadBitmap(this.gpu.device, bitmap)
    const previous = this.source
    this.source = { key: `source-${++this.sourceVersion}`, texture }
    this.output = texture
    this.viewer?.setTextures(texture, texture)
    previous?.texture.destroy()
  }

  /** Runs the stack (only stages whose inputs changed) and points the viewer at the result. */
  process(stages: StageSpec[]): void {
    if (!this.source) return
    const { output } = this.chain.run(this.source, stages)
    this.output = output
    this.viewer?.setTextures(this.source.texture, output)
  }

  draw(frame: ViewerFrame): void {
    this.viewer?.draw(frame)
  }

  async exportPng(): Promise<Uint8Array> {
    if (!this.output) throw new Error('Nothing to export yet.')
    return encodePng(await readTextureRgba8(this.gpu.device, this.output))
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
