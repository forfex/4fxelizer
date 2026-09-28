// Pass framework: every pipeline stage is a compute shader that reads one texture and
// writes one texture. The framework owns bindings, dispatch, pipeline caching and the
// per-stage blend; a pass only supplies a `run` function in WGSL plus its parameter packing.

import { WGSL_LIB } from './wgslLib'

export interface Size {
  width: number
  height: number
}

/** Working format between stages: filterable, storage-capable, more precision than 8-bit. */
export const WORK_FORMAT: GPUTextureFormat = 'rgba16float'

export const BLEND_MODES = [
  { id: 'normal', label: 'Normal' },
  { id: 'multiply', label: 'Multiply' },
  { id: 'screen', label: 'Screen' },
  { id: 'overlay', label: 'Overlay' },
  { id: 'soft-light', label: 'Soft light' },
  { id: 'add', label: 'Add' },
  { id: 'subtract', label: 'Subtract' },
  { id: 'difference', label: 'Difference' },
  { id: 'darken', label: 'Darken' },
  { id: 'lighten', label: 'Lighten' },
  { id: 'luminosity', label: 'Luminosity' },
  { id: 'color', label: 'Color' }
] as const

export type BlendMode = (typeof BLEND_MODES)[number]['id']

/** How a stage's result is blended over its input. */
export interface StageBlend {
  opacity: number
  mode: BlendMode
}

export const DEFAULT_BLEND: StageBlend = { opacity: 1, mode: 'normal' }

export interface PassResources {
  /** Id of the project palette the pass reads (bound as `palette`, count in `paletteCount()`). */
  palette?: string | null
}

export interface PassDef<P = unknown> {
  id: string
  label: string
  /**
   * WGSL source. Must define:
   *   fn run(p: vec2u, size: vec2u) -> vec4f   // color for output texel p of an output of `size`
   * and, if the pass has parameters, `struct Params { ... }` matching `pack`.
   * In scope: `src` (texture_2d<f32>), `params` (uniform Params), `linearSampler`, `palette`,
   * `pattern` (blue noise), and the helpers in wgslLib.ts.
   */
  wgsl: string
  /** Packs params into uniform data laid out like `struct Params` (16-byte aligned). */
  pack?(params: P): ArrayBuffer | Float32Array
  /** Output size; defaults to the input size. */
  outputSize?(input: Size, params: P): Size
  /** Project resources the pass reads. */
  resources?(params: P): PassResources
}

export function definePass<P>(def: PassDef<P>): PassDef<P> {
  return def
}

/** Helper for mixed f32/u32 uniform structs: `packStruct(['f', 1.5], ['u', 3], …)`. */
export function packStruct(...fields: ['f' | 'u' | 'i', number][]): ArrayBuffer {
  const words = Math.max(4, Math.ceil(fields.length / 4) * 4)
  const buffer = new ArrayBuffer(words * 4)
  const view = new DataView(buffer)
  fields.forEach(([type, value], i) => {
    if (type === 'f') view.setFloat32(i * 4, value, true)
    else if (type === 'u') view.setUint32(i * 4, value >>> 0, true)
    else view.setInt32(i * 4, value, true)
  })
  return buffer
}

const WORKGROUP = 8

/** Bytes per palette entry: vec4f color + vec4f OKLab. */
export const PALETTE_ENTRY_BYTES = 32

function shaderSource(def: PassDef<never>): string {
  const hasParams = /\bstruct\s+Params\b/.test(def.wgsl)
  return /* wgsl */ `
${hasParams ? '' : 'struct Params { _unused: vec4f }'}
struct Stage { opacity: f32, blendMode: u32, paletteCount: u32, _pad: u32 }
struct PaletteEntry { color: vec4f, lab: vec4f }

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<${WORK_FORMAT}, write>;
@group(0) @binding(2) var<uniform> params: Params;
@group(0) @binding(3) var linearSampler: sampler;
@group(0) @binding(4) var<storage, read> palette: array<PaletteEntry>;
@group(0) @binding(5) var pattern: texture_2d<f32>;
@group(0) @binding(6) var<uniform> stage: Stage;

${WGSL_LIB}

${def.wgsl}

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  var c = run(id.xy, size);
  if (stage.opacity < 1.0 || stage.blendMode != 0u) {
    c = blendStage(inputAt(id.xy, size), c);
  }
  textureStore(dst, id.xy, c);
}
`
}

/** GPU inputs bound to every pass besides its source texture. */
export interface PassBindings {
  palette: GPUBuffer
  paletteCount: number
  pattern: GPUTexture
}

export class PassRunner {
  readonly layout: GPUBindGroupLayout
  private readonly pipelineLayout: GPUPipelineLayout
  private readonly sampler: GPUSampler
  private readonly pipelines = new Map<string, GPUComputePipeline>()

  constructor(private readonly device: GPUDevice) {
    const compute = GPUShaderStage.COMPUTE
    this.layout = device.createBindGroupLayout({
      label: 'pass',
      entries: [
        { binding: 0, visibility: compute, texture: { sampleType: 'float' } },
        { binding: 1, visibility: compute, storageTexture: { access: 'write-only', format: WORK_FORMAT } },
        { binding: 2, visibility: compute, buffer: { type: 'uniform' } },
        { binding: 3, visibility: compute, sampler: { type: 'filtering' } },
        { binding: 4, visibility: compute, buffer: { type: 'read-only-storage' } },
        { binding: 5, visibility: compute, texture: { sampleType: 'float' } },
        { binding: 6, visibility: compute, buffer: { type: 'uniform' } }
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

  private uniform(label: string, data: ArrayBuffer | Float32Array): GPUBuffer {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    const buffer = this.device.createBuffer({
      label,
      size: Math.max(16, Math.ceil(bytes.byteLength / 16) * 16),
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    })
    this.device.queue.writeBuffer(buffer, 0, bytes as Uint8Array<ArrayBuffer>)
    return buffer
  }

  /** Uniform buffers for one stage run: the pass's params and the framework's stage block. */
  createUniforms<P>(def: PassDef<P>, params: P, blend: StageBlend, paletteCount: number): GPUBuffer[] {
    const mode = BLEND_MODES.findIndex((m) => m.id === blend.mode)
    return [
      this.uniform(`${def.id} params`, def.pack?.(params) ?? new Float32Array(4)),
      this.uniform(
        `${def.id} stage`,
        packStruct(['f', Math.min(Math.max(blend.opacity, 0), 1)], ['u', Math.max(mode, 0)], ['u', paletteCount], ['u', 0])
      )
    ]
  }

  encode(
    encoder: GPUCommandEncoder,
    def: PassDef<never>,
    input: GPUTexture,
    output: GPUTexture,
    uniforms: GPUBuffer[],
    bindings: PassBindings
  ): void {
    const bindGroup = this.device.createBindGroup({
      layout: this.layout,
      entries: [
        { binding: 0, resource: input.createView() },
        { binding: 1, resource: output.createView() },
        { binding: 2, resource: { buffer: uniforms[0]! } },
        { binding: 3, resource: this.sampler },
        { binding: 4, resource: { buffer: bindings.palette } },
        { binding: 5, resource: bindings.pattern.createView() },
        { binding: 6, resource: { buffer: uniforms[1]! } }
      ]
    })
    const pass = encoder.beginComputePass({ label: def.id })
    pass.setPipeline(this.pipeline(def))
    pass.setBindGroup(0, bindGroup)
    pass.dispatchWorkgroups(Math.ceil(output.width / WORKGROUP), Math.ceil(output.height / WORKGROUP))
    pass.end()
  }
}
