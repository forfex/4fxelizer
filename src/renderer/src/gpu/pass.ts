// Pass framework: every pipeline stage is a compute shader that reads one texture and
// writes one texture. The framework owns bindings, dispatch and pipeline caching;
// a pass only supplies a `run` function in WGSL plus its parameter packing.

export interface Size {
  width: number
  height: number
}

/** Working format between stages: filterable, storage-capable, more precision than 8-bit. */
export const WORK_FORMAT: GPUTextureFormat = 'rgba16float'

export interface PassDef<P = unknown> {
  id: string
  label: string
  /**
   * WGSL source. Must define:
   *   fn run(p: vec2u, size: vec2u) -> vec4f   // color for output texel p of an output of `size`
   * and, if the pass has parameters, `struct Params { ... }` matching `pack`.
   * In scope: `src` (texture_2d<f32>), `params` (uniform Params), `linearSampler`.
   */
  wgsl: string
  /** Packs params into uniform data laid out like `struct Params` (16-byte aligned). */
  pack?(params: P): Float32Array
  /** Output size; defaults to the input size. */
  outputSize?(input: Size, params: P): Size
}

export function definePass<P>(def: PassDef<P>): PassDef<P> {
  return def
}

const WORKGROUP = 8

function shaderSource(def: PassDef<never>): string {
  const hasParams = /\bstruct\s+Params\b/.test(def.wgsl)
  return /* wgsl */ `
${hasParams ? '' : 'struct Params { _unused: vec4f }'}
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<${WORK_FORMAT}, write>;
@group(0) @binding(2) var<uniform> params: Params;
@group(0) @binding(3) var linearSampler: sampler;

${def.wgsl}

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  textureStore(dst, id.xy, run(id.xy, size));
}
`
}

export class PassRunner {
  readonly layout: GPUBindGroupLayout
  private readonly pipelineLayout: GPUPipelineLayout
  private readonly sampler: GPUSampler
  private readonly pipelines = new Map<string, GPUComputePipeline>()

  constructor(private readonly device: GPUDevice) {
    this.layout = device.createBindGroupLayout({
      label: 'pass',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: WORK_FORMAT }
        },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } }
      ]
    })
    this.pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [this.layout] })
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  }

  private pipeline(def: PassDef<never>): GPUComputePipeline {
    let pipeline = this.pipelines.get(def.id)
    if (!pipeline) {
      const module = this.device.createShaderModule({ label: def.id, code: shaderSource(def) })
      module.getCompilationInfo().then((info) => {
        for (const m of info.messages) {
          const log = m.type === 'error' ? console.error : console.warn
          log(`[wgsl:${def.id}] ${m.lineNum}:${m.linePos} ${m.message}`)
        }
      })
      pipeline = this.device.createComputePipeline({
        label: def.id,
        layout: this.pipelineLayout,
        compute: { module, entryPoint: 'main' }
      })
      this.pipelines.set(def.id, pipeline)
    }
    return pipeline
  }

  /** Uniform buffer sized for a pass's params (reused across runs of the same stage). */
  createUniform<P>(def: PassDef<P>, params: P): GPUBuffer {
    const data = def.pack?.(params) ?? new Float32Array(4)
    const buffer = this.device.createBuffer({
      label: `${def.id} params`,
      size: Math.max(16, Math.ceil(data.byteLength / 16) * 16),
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    })
    this.device.queue.writeBuffer(buffer, 0, data as Float32Array<ArrayBuffer>)
    return buffer
  }

  encode(encoder: GPUCommandEncoder, def: PassDef<never>, input: GPUTexture, output: GPUTexture, uniform: GPUBuffer): void {
    const bindGroup = this.device.createBindGroup({
      layout: this.layout,
      entries: [
        { binding: 0, resource: input.createView() },
        { binding: 1, resource: output.createView() },
        { binding: 2, resource: { buffer: uniform } },
        { binding: 3, resource: this.sampler }
      ]
    })
    const pass = encoder.beginComputePass({ label: def.id })
    pass.setPipeline(this.pipeline(def))
    pass.setBindGroup(0, bindGroup)
    pass.dispatchWorkgroups(Math.ceil(output.width / WORKGROUP), Math.ceil(output.height / WORKGROUP))
    pass.end()
  }
}
