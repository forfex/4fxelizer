// Bakes maps (AO, cavity, curvature, edge, thickness, height, up-facing) from the model on the GPU,
// in texture space: each texel of the G-buffer is a point on the surface, and rays go out from
// there through the model's BVH. Samples accumulate over many small steps (progressive
// refinement), so the maps sharpen while the UI stays responsive, and a bake can stop early.

import type { BakeMap, BakeSettings } from '@shared/bake'
import type { GBuffer } from '@/model/raster'
import { modelSize } from '@/model/model'
import type { ModelGpu } from '../model/modelGpu'
import { packStruct, WORK_FORMAT } from '../pass'
import { RESOLVE, RESOLVE_WGSL, TRACE, TRACE_WGSL } from './bakeShaders'

interface Output {
  map: BakeMap
  mode: number
  /** Value outside the (padded) UV islands. */
  background: number
  texture: GPUTexture
  uniform: GPUBuffer
  group: GPUBindGroup
}

interface Job {
  label: string
  kind: number
  samples: number
  distance: number
  falloff: number
  cull: boolean
  done: number
  accum: GPUBuffer
  uniform: GPUBuffer
  group: GPUBindGroup
  outputs: Output[]
}

/** GPU time aimed at per step, so a step doesn't hold up the UI. */
const TARGET_MS = 25
const MAX_BATCH = 64

/** The traces a set of maps needs; curvature and edge come from the same probes. */
function plan(settings: BakeSettings, size: number): { label: string; kind: number; samples: number; distance: number; falloff: number; cull: boolean; outputs: { map: BakeMap; mode: number; background: number }[] }[] {
  const m = settings.maps
  const jobs: ReturnType<typeof plan> = []
  if (m.ao) {
    jobs.push({ label: 'AO', kind: TRACE.occlusion, samples: settings.aoSamples, distance: settings.aoDistance * size, falloff: settings.aoFalloff, cull: settings.aoIgnoreBackfaces, outputs: [{ map: 'ao', mode: RESOLVE.invert, background: 1 }] })
  }
  if (m.cavity) {
    jobs.push({ label: 'Cavity', kind: TRACE.occlusion, samples: settings.cavitySamples, distance: settings.cavityDistance * size, falloff: 1, cull: settings.aoIgnoreBackfaces, outputs: [{ map: 'cavity', mode: RESOLVE.invert, background: 1 }] })
  }
  if (m.curvature || m.edge) {
    const outputs: { map: BakeMap; mode: number; background: number }[] = []
    if (m.curvature) outputs.push({ map: 'curvature', mode: RESOLVE.curvature, background: 0.5 })
    if (m.edge) outputs.push({ map: 'edge', mode: RESOLVE.edge, background: 0 })
    jobs.push({ label: m.curvature ? 'Curvature' : 'Edge', kind: TRACE.curvature, samples: settings.edgeSamples, distance: settings.edgeWidth * size, falloff: 0, cull: false, outputs })
  }
  if (m.thickness) {
    jobs.push({ label: 'Thickness', kind: TRACE.thickness, samples: settings.thicknessSamples, distance: settings.thicknessDistance * size, falloff: 0, cull: false, outputs: [{ map: 'thickness', mode: RESOLVE.plain, background: 0 }] })
  }
  if (m.height) jobs.push({ label: 'Height', kind: TRACE.height, samples: 1, distance: 0, falloff: 0, cull: false, outputs: [{ map: 'height', mode: RESOLVE.plain, background: 0 }] })
  if (m.up) jobs.push({ label: 'Up-facing', kind: TRACE.up, samples: 1, distance: 0, falloff: 0, cull: false, outputs: [{ map: 'up', mode: RESOLVE.plain, background: 0 }] })
  return jobs
}

export class Baker {
  readonly width: number
  readonly height: number
  private readonly jobs: Job[]
  private readonly buffers: GPUBuffer[] = []
  private readonly tracePipeline: GPUComputePipeline
  private readonly resolvePipeline: GPUComputePipeline
  private batch = 1
  private next = 0

  constructor(
    private readonly device: GPUDevice,
    private readonly model: ModelGpu,
    gbuffer: GBuffer,
    private readonly settings: BakeSettings
  ) {
    this.width = gbuffer.width
    this.height = gbuffer.height
    const storage = (label: string, data: Float32Array<ArrayBuffer>): GPUBuffer => {
      const b = device.createBuffer({ label, size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
      device.queue.writeBuffer(b, 0, data)
      this.buffers.push(b)
      return b
    }
    const position = storage('bake g-buffer position', gbuffer.position)
    const normal = storage('bake g-buffer normal', gbuffer.normal)
    const bvh = model.bvhStorage()

    const traceModule = device.createShaderModule({ label: 'bake trace', code: TRACE_WGSL })
    this.tracePipeline = device.createComputePipeline({ label: 'bake trace', layout: 'auto', compute: { module: traceModule, entryPoint: 'main' } })
    const resolveModule = device.createShaderModule({ label: 'bake resolve', code: RESOLVE_WGSL })
    this.resolvePipeline = device.createComputePipeline({ label: 'bake resolve', layout: 'auto', compute: { module: resolveModule, entryPoint: 'main' } })

    const size = modelSize(model.data)
    const texels = this.width * this.height
    this.jobs = plan(settings, size).map((p) => {
      const accum = device.createBuffer({ label: `bake ${p.label}`, size: texels * 4, usage: GPUBufferUsage.STORAGE })
      const uniform = device.createBuffer({ label: `bake ${p.label}`, size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
      this.buffers.push(accum, uniform)
      const group = device.createBindGroup({
        layout: this.tracePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: bvh.nodes } },
          { binding: 1, resource: { buffer: bvh.triangles } },
          { binding: 2, resource: { buffer: position } },
          { binding: 3, resource: { buffer: normal } },
          { binding: 4, resource: { buffer: accum } },
          { binding: 5, resource: { buffer: uniform } }
        ]
      })
      const outputs = p.outputs.map((o): Output => {
        const texture = device.createTexture({
          label: `baked ${o.map}`,
          size: [this.width, this.height],
          format: WORK_FORMAT,
          usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC
        })
        const u = device.createBuffer({ label: `resolve ${o.map}`, size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
        this.buffers.push(u)
        const g = device.createBindGroup({
          layout: this.resolvePipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: normal } },
            { binding: 1, resource: { buffer: accum } },
            { binding: 2, resource: { buffer: u } },
            { binding: 3, resource: texture.createView() }
          ]
        })
        return { ...o, texture, uniform: u, group: g }
      })
      return { ...p, done: 0, accum, uniform, group, outputs }
    })
  }

  private writeTraceParams(job: Job, start: number, count: number): void {
    const { min: lo, max: hi } = this.model.data.bounds
    const data = packStruct(
      ['u', this.width], ['u', this.height], ['u', job.kind], ['u', start],
      ['u', count], ['u', job.cull ? 1 : 0], ['u', 0], ['u', 0],
      // Rays start this far off the surface, so they don't hit it again.
      ['f', job.distance], ['f', job.falloff], ['f', modelSize(this.model.data) * 2e-4], ['f', 0],
      ['f', lo[0]!], ['f', lo[1]!], ['f', lo[2]!], ['f', 0],
      ['f', hi[0]!], ['f', hi[1]!], ['f', hi[2]!], ['f', 0]
    )
    this.device.queue.writeBuffer(job.uniform, 0, data)
  }

  /** Maps this bake produces, with the textures it writes them into. */
  get outputs(): { map: BakeMap; texture: GPUTexture }[] {
    return this.jobs.flatMap((j) => j.outputs.map((o) => ({ map: o.map, texture: o.texture })))
  }

  get progress(): { done: number; total: number; label: string } {
    const total = this.jobs.reduce((n, j) => n + j.samples, 0)
    const done = this.jobs.reduce((n, j) => n + j.done, 0)
    return { done, total, label: this.jobs.find((j) => j.done < j.samples)?.label ?? 'Done' }
  }

  get finished(): boolean {
    return this.jobs.every((j) => j.done >= j.samples)
  }

  /**
   * Traces one batch of samples for the next unfinished map, and waits for the GPU. The batch
   * grows or shrinks so each step takes about TARGET_MS.
   */
  async step(): Promise<void> {
    const pending = this.jobs.filter((j) => j.done < j.samples)
    if (!pending.length) return
    const job = pending[this.next++ % pending.length]!
    const count = Math.min(this.batch, job.samples - job.done)
    this.writeTraceParams(job, job.done, count)
    const encoder = this.device.createCommandEncoder({ label: `bake ${job.label}` })
    const pass = encoder.beginComputePass({ label: `bake ${job.label}` })
    pass.setPipeline(this.tracePipeline)
    pass.setBindGroup(0, job.group)
    pass.dispatchWorkgroups(Math.ceil(this.width / 8), Math.ceil(this.height / 8))
    pass.end()
    const t0 = performance.now()
    this.device.queue.submit([encoder.finish()])
    await this.device.queue.onSubmittedWorkDone()
    job.done += count
    // Only ray-traced maps say anything about speed (height and up-facing are one cheap sample).
    if (job.samples > 1) {
      const ms = performance.now() - t0
      if (ms < TARGET_MS / 2) this.batch = Math.min(this.batch * 2, MAX_BATCH)
      else if (ms > TARGET_MS * 2 && this.batch > 1) this.batch = Math.max(1, this.batch >> 1)
    }
  }

  /** Writes every map's current state into its texture. Skips maps whose texture `keep` rejects. */
  resolve(keep: (map: BakeMap, texture: GPUTexture) => boolean = () => true): void {
    const encoder = this.device.createCommandEncoder({ label: 'bake resolve' })
    const pass = encoder.beginComputePass({ label: 'bake resolve' })
    pass.setPipeline(this.resolvePipeline)
    for (const job of this.jobs) {
      for (const o of job.outputs) {
        if (!keep(o.map, o.texture)) continue
        const data = packStruct(
          ['u', this.width], ['u', this.height], ['u', o.mode], ['u', 0],
          ['f', job.done ? 1 / job.done : 0], ['f', this.settings.edgeStrength], ['f', o.background], ['f', 0]
        )
        this.device.queue.writeBuffer(o.uniform, 0, data)
        pass.setBindGroup(0, o.group)
        pass.dispatchWorkgroups(Math.ceil(this.width / 8), Math.ceil(this.height / 8))
      }
    }
    pass.end()
    this.device.queue.submit([encoder.finish()])
  }

  /** Frees the bake's buffers. The map textures are left alone: the map slots own them. */
  dispose(): void {
    for (const b of this.buffers) b.destroy()
    this.buffers.length = 0
  }
}
