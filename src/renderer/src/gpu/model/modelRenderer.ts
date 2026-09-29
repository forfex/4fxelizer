// Draws the model in the 3D view: a shadow map from the key light (lit styles), then the model
// into an offscreen framebuffer (low-res for the console looks, multisampled when antialiased),
// then that framebuffer scaled up to the canvas. Each material is drawn with its own texture's
// GPU textures (the processed result, the source or a map) and maps, so the view shows every
// change without reading anything back.

import { VIEW3D_DITHERS, VIEW3D_FILTERS, VIEW3D_SHADINGS, VIEW3D_SURFACES, VIEW3D_WIREFRAMES, type View3dStyle } from '@shared/view3d'
import { basis, eye, lightProjection, normalize, viewProjection, type OrbitCamera, type Vec3 } from '@/viewer3d/camera'
import { WORK_FORMAT } from '../pass'
import type { Rgba } from '../viewer'
import blitShader from './blit.wgsl?raw'
import shader from './model.wgsl?raw'
import type { ModelGpu } from './modelGpu'

/** A map the lit style reads, and which of its channels. */
export interface FrameMap {
  texture: GPUTexture
  /** 0 = brightness, 1–4 = r, g, b, a (MAP_CHANNELS order). */
  channel: number
}

/** What a material is drawn with: a texture of the engine, and the maps of the same texture. */
export interface PartTexture {
  texture: GPUTexture
  /** 0 = the texture's colors; 1 + map channel index = that channel in gray (map views). */
  view: number
  /** Maps the per-pixel shading reads (when the style uses maps). */
  maps: { ao?: FrameMap; roughness?: FrameMap; metallic?: FrameMap }
}

export interface ModelFrame {
  model: ModelGpu | null
  uvSet: number
  /** Per material: its texture, or null for its flat base color. */
  parts: (PartTexture | null)[]
  camera: OrbitCamera
  style: View3dStyle
  background: Rgba
  wireColor: Rgba
  /** Device pixels per CSS pixel: wire width at full resolution. */
  pixelRatio: number
  /** Key light (sun) turned around the vertical axis, radians (Alt-drag in the view). */
  lightYaw: number
}

/** Uniform slots per part are 256 bytes apart (minUniformBufferOffsetAlignment). */
const PART_STRIDE = 256
const FRAME_FORMAT: GPUTextureFormat = 'rgba8unorm'
const DEPTH_FORMAT: GPUTextureFormat = 'depth24plus'
const FRAME_UNIFORM_BYTES = 288
const PART_BYTES = 48
const SHADOW_SIZE = 2048
const MSAA_SAMPLES = 4
/** Line count vertices snap to when the view renders at full resolution. */
const SNAP_LINES = 240
const EXPOSURE = 1

interface Target {
  width: number
  height: number
  samples: number
  color: GPUTexture
  /** Multisampled color, resolved into `color` (antialiased styles only). */
  multisampled: GPUTexture | null
  depth: GPUTexture
  blit: GPUBindGroup
}

export class ModelRenderer {
  private readonly context: GPUCanvasContext
  private readonly module: GPUShaderModule
  private readonly layout: GPUPipelineLayout
  private readonly frameLayout: GPUBindGroupLayout
  private readonly partLayout: GPUBindGroupLayout
  private readonly textureLayout: GPUBindGroupLayout
  private readonly pipelines = new Map<string, GPURenderPipeline>()
  private readonly shadowPipeline: GPURenderPipeline
  private readonly blitPipeline: GPURenderPipeline
  private readonly frameUniform: GPUBuffer
  private readonly blitUniform: GPUBuffer
  private readonly blitSampler: GPUSampler
  private readonly shadowSampler: GPUSampler
  private readonly placeholder: GPUTexture
  private readonly placeholderDepth: GPUTexture
  private shadowMap: GPUTexture | null = null
  private partUniform: GPUBuffer | null = null
  private partGroup: GPUBindGroup | null = null
  private target: Target | null = null

  constructor(
    private readonly device: GPUDevice,
    readonly canvas: HTMLCanvasElement
  ) {
    const context = canvas.getContext('webgpu')
    if (!context) throw new Error('Could not create a WebGPU canvas context.')
    this.context = context
    const format = navigator.gpu.getPreferredCanvasFormat()
    context.configure({ device, format, alphaMode: 'opaque' })

    const both = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT
    const texture = (binding: number): GPUBindGroupLayoutEntry => ({ binding, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } })
    this.frameLayout = device.createBindGroupLayout({
      label: '3d frame',
      entries: [
        { binding: 0, visibility: both, buffer: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
        { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }
      ]
    })
    this.partLayout = device.createBindGroupLayout({
      label: '3d part',
      entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { hasDynamicOffset: true, minBindingSize: PART_BYTES } }]
    })
    this.textureLayout = device.createBindGroupLayout({ label: '3d textures', entries: [texture(0), texture(1), texture(2), texture(3)] })
    this.module = device.createShaderModule({ label: '3d view', code: shader })
    this.layout = device.createPipelineLayout({ bindGroupLayouts: [this.frameLayout, this.partLayout, this.textureLayout] })
    this.shadowPipeline = device.createRenderPipeline({
      label: '3d shadow map',
      layout: this.layout,
      vertex: { module: this.module, entryPoint: 'vsShadow' },
      fragment: { module: this.module, entryPoint: 'fsShadow', targets: [] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2 }
    })
    const blitModule = device.createShaderModule({ label: '3d blit', code: blitShader })
    this.blitPipeline = device.createRenderPipeline({
      label: '3d blit',
      layout: 'auto',
      vertex: { module: blitModule, entryPoint: 'vs' },
      fragment: { module: blitModule, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' }
    })
    this.frameUniform = device.createBuffer({ label: '3d frame', size: FRAME_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.blitUniform = device.createBuffer({ label: '3d blit', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.blitSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
    this.shadowSampler = device.createSampler({ compare: 'less-equal', magFilter: 'linear', minFilter: 'linear' })
    this.placeholder = device.createTexture({ label: '3d placeholder', size: [1, 1], format: WORK_FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING })
    this.placeholderDepth = device.createTexture({
      label: '3d placeholder depth',
      size: [1, 1],
      format: 'depth32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
    })
  }

  /** The main pipeline for a sample count and culling (built on first use). */
  private pipeline(samples: number, cull: boolean): GPURenderPipeline {
    const key = `${samples}:${cull}`
    let p = this.pipelines.get(key)
    if (!p) {
      p = this.device.createRenderPipeline({
        label: `3d view (${key})`,
        layout: this.layout,
        vertex: { module: this.module, entryPoint: 'vs' },
        fragment: { module: this.module, entryPoint: 'fs', targets: [{ format: FRAME_FORMAT }] },
        // Models are counter-clockwise (glTF); mirrored parts were re-wound on load.
        primitive: { topology: 'triangle-list', cullMode: cull ? 'back' : 'none', frontFace: 'ccw' },
        depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
        multisample: { count: samples }
      })
      this.pipelines.set(key, p)
    }
    return p
  }

  /** Framebuffer size for the canvas: its own size, or `lines` tall at the canvas's aspect ratio. */
  private frameSize(resolution: View3dStyle['resolution']): [number, number] {
    const { width, height } = this.canvas
    if (resolution === 'full' || height <= Number(resolution)) return [width, height]
    const h = Number(resolution)
    return [Math.max(1, Math.round((width * h) / height)), h]
  }

  private ensureTarget(width: number, height: number, samples: number): Target {
    const t = this.target
    if (t && t.width === width && t.height === height && t.samples === samples) return t
    this.destroyTarget()
    const usage = GPUTextureUsage.RENDER_ATTACHMENT
    const color = this.device.createTexture({ label: '3d framebuffer', size: [width, height], format: FRAME_FORMAT, usage: usage | GPUTextureUsage.TEXTURE_BINDING })
    const multisampled =
      samples > 1 ? this.device.createTexture({ label: '3d framebuffer (MSAA)', size: [width, height], format: FRAME_FORMAT, usage, sampleCount: samples }) : null
    const depth = this.device.createTexture({ label: '3d depth', size: [width, height], format: DEPTH_FORMAT, usage, sampleCount: samples })
    const blit = this.device.createBindGroup({
      layout: this.blitPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: color.createView() },
        { binding: 1, resource: { buffer: this.blitUniform } },
        { binding: 2, resource: this.blitSampler }
      ]
    })
    this.target = { width, height, samples, color, multisampled, depth, blit }
    return this.target
  }

  private destroyTarget(): void {
    this.target?.color.destroy()
    this.target?.multisampled?.destroy()
    this.target?.depth.destroy()
    this.target = null
  }

  private frameGroup(frame: ModelFrame, model: ModelGpu, shadowMap: GPUTexture): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.frameLayout,
      entries: [
        { binding: 0, resource: { buffer: this.frameUniform } },
        { binding: 1, resource: shadowMap.createView() },
        { binding: 2, resource: this.shadowSampler },
        { binding: 3, resource: { buffer: model.vertexBuffer(frame.uvSet) } },
        { binding: 4, resource: { buffer: model.index } }
      ]
    })
  }

  /** Texture bind groups per material (materials drawn with the same texture share one). */
  private textureGroups(frame: ModelFrame, count: number): GPUBindGroup[] {
    const view = (t: GPUTexture | null | undefined): GPUTextureView => (t ?? this.placeholder).createView()
    const groups = new Map<PartTexture | null, GPUBindGroup>()
    return Array.from({ length: count }, (_, i) => {
      const part = frame.parts[i] ?? null
      let group = groups.get(part)
      if (!group) {
        group = this.device.createBindGroup({
          layout: this.textureLayout,
          entries: [
            { binding: 0, resource: view(part?.texture) },
            { binding: 1, resource: view(part?.maps.ao?.texture) },
            { binding: 2, resource: view(part?.maps.roughness?.texture) },
            { binding: 3, resource: view(part?.maps.metallic?.texture) }
          ]
        })
        groups.set(part, group)
      }
      return group
    })
  }

  private writeParts(frame: ModelFrame, model: ModelGpu): void {
    const count = model.data.parts.length
    const size = Math.max(count, 1) * PART_STRIDE
    if (!this.partUniform || this.partUniform.size < size) {
      this.partUniform?.destroy()
      this.partUniform = this.device.createBuffer({ label: '3d parts', size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
      this.partGroup = this.device.createBindGroup({
        layout: this.partLayout,
        entries: [{ binding: 0, resource: { buffer: this.partUniform, size: PART_BYTES } }]
      })
    }
    const buffer = new ArrayBuffer(size)
    const f = new Float32Array(buffer)
    const u = new Uint32Array(buffer)
    const mapSlot = (m: FrameMap | undefined): number => (m && frame.style.maps ? 1 + m.channel : 0)
    model.data.materials.forEach((m, i) => {
      const part = frame.parts[i]
      const o = (i * PART_STRIDE) / 4
      f.set([...m.color, 1, part ? 1 : 0, part?.view ?? 0, 0, 0], o)
      u.set([mapSlot(part?.maps.ao), mapSlot(part?.maps.roughness), mapSlot(part?.maps.metallic), 0], o + 8)
    })
    this.device.queue.writeBuffer(this.partUniform, 0, buffer)
  }

  private writeFrame(frame: ModelFrame, model: ModelGpu, lit: { key: Vec3; lightViewProj: Float32Array; shadowTexel: number; shadows: boolean }): void {
    const { width, height } = this.canvas
    const s = frame.style
    const { min, max } = model.data.bounds
    const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2 || 1
    const { right, up, forward } = basis(frame.camera)
    const along = (r: number, u: number, f: number): Vec3 => normalize([0, 1, 2].map((a) => right[a]! * r + up[a]! * u + forward[a]! * f) as Vec3)
    const lines = s.resolution === 'full' ? SNAP_LINES : Number(s.resolution)
    const wireWidth = s.resolution === 'full' ? Math.max(1, frame.pixelRatio) : 1
    const fogStart = frame.camera.distance - radius * 0.5
    const lookup = <T>(list: readonly T[], v: T): number => Math.max(list.indexOf(v), 0)

    const buffer = new ArrayBuffer(FRAME_UNIFORM_BYTES)
    const f = new Float32Array(buffer)
    const u = new Uint32Array(buffer)
    f.set(viewProjection(frame.camera, width / height, radius), 0)
    f.set(lit.lightViewProj, 16)
    f.set([...eye(frame.camera), wireWidth], 32)
    f.set([...lit.key, s.ambient], 36)
    // Fill from the lower right, rim from behind (towards the camera, from above).
    f.set([...along(-0.7, 0.3, 0.6), s.specular], 40)
    f.set([...along(0.2, -0.5, -0.8), EXPOSURE], 44)
    f.set([((lines * width) / height) / 2, lines / 2, s.snap ? 1 : 0, s.affine ? 1 : 0], 48)
    f.set([fogStart, fogStart + radius * 2, s.fog, lit.shadowTexel], 52)
    f.set(frame.background, 56)
    f.set(frame.wireColor, 60)
    u.set([lookup(VIEW3D_SHADINGS, s.shading), lookup(VIEW3D_SURFACES, s.surface), 0, lookup(VIEW3D_FILTERS, s.filter)], 64)
    u.set([lookup(VIEW3D_WIREFRAMES, s.wireframe), s.colorDepth === 'rgb555' ? 1 : 0, lookup(VIEW3D_DITHERS, s.dither), lit.shadows ? 1 : 0], 68)
    this.device.queue.writeBuffer(this.frameUniform, 0, buffer)
  }

  private drawParts(pass: GPURenderPassEncoder, model: ModelGpu, textures: GPUBindGroup[]): void {
    model.data.parts.forEach((part, i) => {
      if (!part.count) return
      pass.setBindGroup(1, this.partGroup!, [i * PART_STRIDE])
      pass.setBindGroup(2, textures[i]!)
      pass.draw(part.count * 3, 1, part.first * 3)
    })
  }

  draw(frame: ModelFrame): void {
    const { width, height } = this.canvas
    if (!width || !height) return
    const s = frame.style
    const [fw, fh] = this.frameSize(s.resolution)
    const samples = s.antialias ? MSAA_SAMPLES : 1
    const target = this.ensureTarget(fw, fh, samples)
    const model = frame.model
    const encoder = this.device.createCommandEncoder({ label: '3d view' })

    let group: GPUBindGroup | null = null
    let textures: GPUBindGroup[] = []
    if (model) {
      textures = this.textureGroups(frame, model.data.parts.length)
      const { min, max } = model.data.bounds
      const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
      const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2 || 1
      const { right, up, forward } = basis(frame.camera)
      // The key light comes from the upper left, behind the viewer, so the model is lit from the camera side.
      const [kx, ky, kz] = [0, 1, 2].map((a) => right[a]! * 0.75 - up[a]! * 0.9 + forward[a]! * 0.35)
      const cos = Math.cos(frame.lightYaw)
      const sin = Math.sin(frame.lightYaw)
      const key = normalize([kx! * cos + kz! * sin, ky!, kz! * cos - kx! * sin])
      const shadows = s.shadows && s.shading === 'pixel' && s.surface !== 'normals' && s.wireframe !== 'only'
      const lightViewProj = lightProjection(key, center, radius)
      this.writeFrame(frame, model, { key, lightViewProj, shadowTexel: (radius * 2) / SHADOW_SIZE, shadows })
      this.writeParts(frame, model)

      if (shadows) {
        this.shadowMap ??= this.device.createTexture({
          label: '3d shadow map',
          size: [SHADOW_SIZE, SHADOW_SIZE],
          format: 'depth32float',
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        })
        const pass = encoder.beginRenderPass({
          colorAttachments: [],
          depthStencilAttachment: { view: this.shadowMap.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' }
        })
        pass.setPipeline(this.shadowPipeline)
        // The shadow map can't be read while it's drawn: this pass binds a placeholder.
        pass.setBindGroup(0, this.frameGroup(frame, model, this.placeholderDepth))
        this.drawParts(pass, model, textures)
        pass.end()
      }
      group = this.frameGroup(frame, model, shadows ? this.shadowMap! : this.placeholderDepth)
    }

    const bg = frame.background
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: (target.multisampled ?? target.color).createView(),
          resolveTarget: target.multisampled ? target.color.createView() : undefined,
          clearValue: { r: bg[0], g: bg[1], b: bg[2], a: 1 },
          loadOp: 'clear',
          storeOp: target.multisampled ? 'discard' : 'store'
        }
      ],
      depthStencilAttachment: { view: target.depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' }
    })
    if (model && group) {
      pass.setPipeline(this.pipeline(samples, !s.backfaces))
      pass.setBindGroup(0, group)
      this.drawParts(pass, model, textures)
    }
    pass.end()

    this.device.queue.writeBuffer(this.blitUniform, 0, new Float32Array([fw / width, fh / height, s.upscale === 'smooth' ? 1 : 0, 0]))
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
    this.destroyTarget()
    this.shadowMap?.destroy()
    this.shadowMap = null
    this.partUniform?.destroy()
    this.frameUniform.destroy()
    this.blitUniform.destroy()
    this.placeholder.destroy()
    this.placeholderDepth.destroy()
    this.context.unconfigure()
  }
}
