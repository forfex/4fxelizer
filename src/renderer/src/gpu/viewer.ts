import type { Size, View } from '@/viewer/viewport'
import shader from './viewer.wgsl?raw'
import { WORK_FORMAT } from './pass'

export type Rgba = [number, number, number, number]

export interface ViewerFrame {
  view: View
  image: Size | null
  /** Split position in canvas device pixels, or null for "after" only. */
  splitX: number | null
  grid: boolean
  background: Rgba
  checkerA: Rgba
  checkerB: Rgba
}

/** Minimum on-screen texel size (device px) at which the pixel grid appears. */
const GRID_MIN_TEXEL = 6
const CHECKER_SIZE = 8

export class ViewerRenderer {
  private readonly context: GPUCanvasContext
  private readonly pipeline: GPURenderPipeline
  private readonly uniform: GPUBuffer
  private readonly sampler: GPUSampler
  private readonly placeholder: GPUTexture
  private bindGroup: GPUBindGroup
  private readonly data = new Float32Array(24)

  constructor(
    private readonly device: GPUDevice,
    readonly canvas: HTMLCanvasElement
  ) {
    const context = canvas.getContext('webgpu')
    if (!context) throw new Error('Could not create a WebGPU canvas context.')
    this.context = context
    const format = navigator.gpu.getPreferredCanvasFormat()
    context.configure({ device, format, alphaMode: 'opaque' })

    const module = device.createShaderModule({ label: 'viewer', code: shader })
    this.pipeline = device.createRenderPipeline({
      label: 'viewer',
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' }
    })
    this.uniform = device.createBuffer({
      label: 'viewer',
      size: this.data.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    })
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
    this.placeholder = device.createTexture({
      size: [1, 1],
      format: WORK_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING
    })
    this.bindGroup = this.createBindGroup(this.placeholder, this.placeholder)
  }

  private createBindGroup(before: GPUTexture, after: GPUTexture): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniform } },
        { binding: 1, resource: before.createView() },
        { binding: 2, resource: after.createView() },
        { binding: 3, resource: this.sampler }
      ]
    })
  }

  /** Must be called before a texture shown here is destroyed. */
  setTextures(before: GPUTexture | null, after: GPUTexture | null): void {
    this.bindGroup = this.createBindGroup(before ?? this.placeholder, after ?? before ?? this.placeholder)
  }

  draw(frame: ViewerFrame): void {
    const { width, height } = this.canvas
    if (width === 0 || height === 0) return
    const d = this.data
    d.set([width, height, frame.image?.width ?? 1, frame.image?.height ?? 1])
    d.set([frame.view.x, frame.view.y, frame.view.zoom, frame.splitX ?? -1], 4)
    d.set([frame.grid ? GRID_MIN_TEXEL : 0, CHECKER_SIZE, frame.image ? 1 : 0, 0], 8)
    d.set(frame.background, 12)
    d.set(frame.checkerA, 16)
    d.set(frame.checkerB, 20)
    this.device.queue.writeBuffer(this.uniform, 0, d)

    const encoder = this.device.createCommandEncoder({ label: 'viewer' })
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 }
        }
      ]
    })
    pass.setPipeline(this.pipeline)
    pass.setBindGroup(0, this.bindGroup)
    pass.draw(3)
    pass.end()
    this.device.queue.submit([encoder.finish()])
  }

  dispose(): void {
    this.context.unconfigure()
    this.uniform.destroy()
    this.placeholder.destroy()
  }
}
