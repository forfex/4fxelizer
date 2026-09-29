// Draws the model in the 3D view: into an offscreen framebuffer (low-res for the PSX look), then
// scaled up to the canvas. Textures are the engine's own (the processed result, the source or a
// map), so the view shows every change without reading anything back.

import type { View3dSettings } from '@shared/bake'
import { basis, normalize, viewProjection, type OrbitCamera, type Vec3 } from '@/viewer3d/camera'
import { WORK_FORMAT } from '../pass'
import type { Rgba } from '../viewer'
import blitShader from './blit.wgsl?raw'
import shader from './model.wgsl?raw'
import { VERTEX_FLOATS, type ModelGpu } from './modelGpu'

export interface ModelFrame {
  model: ModelGpu | null
  uvSet: number
  /** Material (texture set) drawn with `texture`; the others get their flat base color. */
  material: number
  texture: GPUTexture | null
  /** 0 = the texture's colors; 1 + map channel index = that channel in gray (map views). */
  textureView: number
  camera: OrbitCamera
  settings: View3dSettings
  background: Rgba
}

/** Uniform slots per part are 256 bytes apart (minUniformBufferOffsetAlignment). */
const PART_STRIDE = 256
const FRAME_FORMAT: GPUTextureFormat = 'rgba8unorm'
const AMBIENT = 0.35
/** Line count vertices snap to when the view renders at full resolution. */
const SNAP_LINES = 240

export class ModelRenderer {
  private readonly context: GPUCanvasContext
  private readonly pipeline: GPURenderPipeline
  private readonly blitPipeline: GPURenderPipeline
  private readonly frameLayout: GPUBindGroupLayout
  private readonly partLayout: GPUBindGroupLayout
  private readonly frameUniform: GPUBuffer
  private readonly blitUniform: GPUBuffer
  private readonly samplers: { nearest: GPUSampler; linear: GPUSampler }
  private readonly placeholder: GPUTexture
  private partUniform: GPUBuffer | null = null
  private partGroup: GPUBindGroup | null = null
  private target: { color: GPUTexture; depth: GPUTexture; blit: GPUBindGroup } | null = null
  private textureGroup: { texture: GPUTexture; filter: boolean; group: GPUBindGroup } | null = null

  constructor(
    private readonly device: GPUDevice,
    readonly canvas: HTMLCanvasElement
  ) {
    const context = canvas.getContext('webgpu')
    if (!context) throw new Error('Could not create a WebGPU canvas context.')
    this.context = context
    const format = navigator.gpu.getPreferredCanvasFormat()
    context.configure({ device, format, alphaMode: 'opaque' })

    this.frameLayout = device.createBindGroupLayout({
      label: '3d frame',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} }
      ]
    })
    this.partLayout = device.createBindGroupLayout({
      label: '3d part',
      entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { hasDynamicOffset: true, minBindingSize: 32 } }]
    })
    const module = device.createShaderModule({ label: '3d view', code: shader })
    this.pipeline = device.createRenderPipeline({
      label: '3d view',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.frameLayout, this.partLayout] }),
      vertex: {
        module,
        entryPoint: 'vs',
        buffers: [
          {
            arrayStride: VERTEX_FLOATS * 4,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x3' },
              { shaderLocation: 2, offset: 24, format: 'float32x2' }
            ]
          }
        ]
      },
      fragment: { module, entryPoint: 'fs', targets: [{ format: FRAME_FORMAT }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' }
    })
    const blitModule = device.createShaderModule({ label: '3d blit', code: blitShader })
    this.blitPipeline = device.createRenderPipeline({
      label: '3d blit',
      layout: 'auto',
      vertex: { module: blitModule, entryPoint: 'vs' },
      fragment: { module: blitModule, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' }
    })
    this.frameUniform = device.createBuffer({ label: '3d frame', size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.blitUniform = device.createBuffer({ label: '3d blit', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    const sampler = (filter: GPUFilterMode): GPUSampler =>
      device.createSampler({ magFilter: filter, minFilter: filter, addressModeU: 'repeat', addressModeV: 'repeat' })
    this.samplers = { nearest: sampler('nearest'), linear: sampler('linear') }
    this.placeholder = device.createTexture({ label: '3d placeholder', size: [1, 1], format: WORK_FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING })
  }

  /** Framebuffer size for the canvas: its own size, or `lines` tall at the canvas's aspect ratio. */
  private frameSize(resolution: View3dSettings['resolution']): [number, number] {
    const { width, height } = this.canvas
    if (resolution === 'full' || height <= Number(resolution)) return [width, height]
    const h = Number(resolution)
    return [Math.max(1, Math.round((width * h) / height)), h]
  }

  private ensureTarget(width: number, height: number): NonNullable<ModelRenderer['target']> {
    const t = this.target
    if (t && t.color.width === width && t.color.height === height) return t
    t?.color.destroy()
    t?.depth.destroy()
    const color = this.device.createTexture({
      label: '3d framebuffer',
      size: [width, height],
      format: FRAME_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    })
    const depth = this.device.createTexture({ label: '3d depth', size: [width, height], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT })
    const blit = this.device.createBindGroup({
      layout: this.blitPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: color.createView() },
        { binding: 1, resource: { buffer: this.blitUniform } }
      ]
    })
    this.target = { color, depth, blit }
    return this.target
  }

  /** Bind group for a texture and filter; rebuilt only when either changes. */
  private textureBindGroup(texture: GPUTexture, filter: boolean): GPUBindGroup {
    const cached = this.textureGroup
    if (cached && cached.texture === texture && cached.filter === filter) return cached.group
    const group = this.device.createBindGroup({
      layout: this.frameLayout,
      entries: [
        { binding: 0, resource: { buffer: this.frameUniform } },
        { binding: 1, resource: texture.createView() },
        { binding: 2, resource: filter ? this.samplers.linear : this.samplers.nearest }
      ]
    })
    this.textureGroup = { texture, filter, group }
    return group
  }

  private writeParts(frame: ModelFrame, model: ModelGpu): void {
    const count = model.data.parts.length
    const size = Math.max(count, 1) * PART_STRIDE
    if (!this.partUniform || this.partUniform.size < size) {
      this.partUniform?.destroy()
      this.partUniform = this.device.createBuffer({ label: '3d parts', size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
      this.partGroup = this.device.createBindGroup({
        layout: this.partLayout,
        entries: [{ binding: 0, resource: { buffer: this.partUniform, size: 32 } }]
      })
    }
    const data = new Float32Array(size / 4)
    model.data.materials.forEach((m, i) => {
      const textured = !!frame.texture && i === frame.material
      data.set([...m.color, 1, textured ? 1 : 0, 0, 0, 0], (i * PART_STRIDE) / 4)
    })
    this.device.queue.writeBuffer(this.partUniform, 0, data)
  }

  draw(frame: ModelFrame): void {
    const { width, height } = this.canvas
    if (!width || !height) return
    const [fw, fh] = this.frameSize(frame.settings.resolution)
    const target = this.ensureTarget(fw, fh)
    const model = frame.model

    const encoder = this.device.createCommandEncoder({ label: '3d view' })
    const bg = frame.background
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: target.color.createView(), clearValue: { r: bg[0], g: bg[1], b: bg[2], a: 1 }, loadOp: 'clear', storeOp: 'store' }
      ],
      depthStencilAttachment: { view: target.depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' }
    })
    if (model) {
      const { min, max } = model.data.bounds
      const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2 || 1
      const { right, up, forward } = basis(frame.camera)
      // A light from the upper left, behind the viewer, so the model is always lit from the camera side.
      const light: Vec3 = normalize([0, 1, 2].map((a) => right[a]! * 0.5 - up[a]! * 0.8 + forward[a]! * 0.6) as Vec3)
      const s = frame.settings
      const lines = s.resolution === 'full' ? SNAP_LINES : Number(s.resolution)
      const uniforms = new Float32Array(28)
      uniforms.set(viewProjection(frame.camera, width / height, radius), 0)
      uniforms.set([...light, AMBIENT], 16)
      uniforms.set([((lines * width) / height) / 2, lines / 2, s.snap ? 1 : 0, s.affine ? 1 : 0], 20)
      uniforms.set([s.lighting ? 1 : 0, s.dither ? 1 : 0, frame.textureView, 0], 24)
      this.device.queue.writeBuffer(this.frameUniform, 0, uniforms)
      this.writeParts(frame, model)

      pass.setPipeline(this.pipeline)
      pass.setBindGroup(0, this.textureBindGroup(frame.texture ?? this.placeholder, s.filter))
      pass.setVertexBuffer(0, model.vertexBuffer(frame.uvSet))
      pass.setIndexBuffer(model.index, 'uint32')
      model.data.parts.forEach((part, i) => {
        if (!part.count) return
        pass.setBindGroup(1, this.partGroup!, [i * PART_STRIDE])
        pass.drawIndexed(part.count * 3, 1, part.first * 3)
      })
    }
    pass.end()

    this.device.queue.writeBuffer(this.blitUniform, 0, new Float32Array([fw / width, fh / height, 0, 0]))
    const out = encoder.beginRenderPass({
      colorAttachments: [{ view: this.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }]
    })
    out.setPipeline(this.blitPipeline)
    out.setBindGroup(0, target.blit)
    out.draw(3)
    out.end()
    this.device.queue.submit([encoder.finish()])
  }

  dispose(): void {
    this.target?.color.destroy()
    this.target?.depth.destroy()
    this.target = null
    this.partUniform?.destroy()
    this.frameUniform.destroy()
    this.blitUniform.destroy()
    this.placeholder.destroy()
    this.textureGroup = null
    this.context.unconfigure()
  }
}
