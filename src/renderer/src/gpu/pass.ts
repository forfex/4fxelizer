// Pass framework: every pipeline stage is a compute shader that reads one texture and
// writes one texture. The framework owns bindings, dispatch, pipeline caching and the
// per-stage blend; a pass only supplies a `run` function in WGSL plus its parameter packing.

import type { MapSlot } from '@shared/maps'
import type { MaskSpec } from './mask'
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
  /** Imported map slots the pass reads (through its mask). */
  maps?: MapSlot[]
  /** Custom threshold pattern (encoded, see dither/customPattern.ts), bound as `customPattern`. */
  pattern?: string
}

/** Stack-wide facts a pass may need beyond its own input. */
export interface PassContext {
  /** Size of the loaded source image. */
  source: Size
}

export interface PassDef<P = unknown> {
  id: string
  label: string
  /**
   * WGSL source. Must define:
   *   fn run(p: vec2u, size: vec2u) -> vec4f   // color for output texel p of an output of `size`
   * and, if the pass has parameters, `struct Params { ... }` matching `pack`.
   * In scope: `src` (texture_2d<f32>), `params` (uniform Params), `linearSampler`, `palette`,
   * `pattern` (blue noise), `customPattern` (thresholds of a custom pattern image, r32float),
   * `scratch` (read-write storage, see `scratchBytes`), the stage mask
   * (`maskAt(p, size)`, see `mask`) and the helpers in wgslLib.ts.
   *
   * A pass whose pixels depend on each other (error diffusion) can also define
   *   fn runRows(thread: u32, size: vec2u)      // one workgroup of ROW_THREADS threads
   * which writes every output texel itself through `emit(p, size, color)`. It runs instead of
   * `run` when `serial(params)` returns true.
   */
  wgsl: string
  /** Packs params into uniform data laid out like `struct Params` (16-byte aligned). */
  pack?(params: P): ArrayBuffer | Float32Array
  /** Output size; defaults to the input size. `ctx.source` is the original image size. */
  outputSize?(input: Size, params: P, ctx?: PassContext): Size
  /** Project resources the pass reads. */
  resources?(params: P): PassResources
  /** True to run `runRows` (a single workgroup) instead of `run` per texel. */
  serial?(params: P): boolean
  /** Bytes of zeroed `scratch` storage the serial path needs for an output of `size`. */
  scratchBytes?(size: Size, params: P): number
  /** The mask to build before the pass runs (read with `maskAt`); null = none (maskAt is 1). */
  mask?(params: P): MaskSpec | null
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
/** Threads in the single workgroup of a serial (`runRows`) pass. */
export const ROW_THREADS = 256

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
@group(0) @binding(7) var<storage, read_write> scratch: array<vec4f>;
@group(0) @binding(8) var maskTex: texture_2d<f32>;
@group(0) @binding(9) var customPattern: texture_2d<f32>;

const ROW_THREADS = ${ROW_THREADS}u;

${WGSL_LIB}

/** Applies the stage blend and writes output texel p (for serial passes). */
fn emit(p: vec2u, size: vec2u, color: vec4f) {
  var c = color;
  if (stage.opacity < 1.0 || stage.blendMode != 0u) {
    c = blendStage(inputAt(p, size), c);
  }
  textureStore(dst, p, c);
}

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
${/\bfn\s+runRows\b/.test(def.wgsl) ? ROWS_ENTRY : ''}`
}

const ROWS_ENTRY = /* wgsl */ `
@compute @workgroup_size(${ROW_THREADS})
fn mainRows(@builtin(local_invocation_index) thread: u32) {
  runRows(thread, textureDimensions(dst));
}
`

/** GPU inputs bound to every pass besides its source texture. */
export interface PassBindings {
  palette: GPUBuffer
  paletteCount: number
  pattern: GPUTexture
  /** Run the pass's serial `runRows` entry (see PassDef.serial). */
  serial?: boolean
  /** Zeroed storage for the serial path; defaults to a tiny placeholder. */
  scratch?: GPUBuffer | null
  /** The stage mask (see PassDef.mask); defaults to white (no mask). */
  mask?: GPUTexture | null
  /** Custom pattern thresholds (r32float); defaults to a single 0.5. */
  customPattern?: GPUTexture | null
}

export class PassRunner {
  readonly layout: GPUBindGroupLayout
  private readonly pipelineLayout: GPUPipelineLayout
  private readonly sampler: GPUSampler
  private readonly pipelines = new Map<string, GPUComputePipeline>()
  private readonly modules = new Map<string, GPUShaderModule>()
  private readonly emptyScratch: GPUBuffer
  private readonly noMask: GPUTexture
  private readonly noPattern: GPUTexture

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
        { binding: 6, visibility: compute, buffer: { type: 'uniform' } },
        { binding: 7, visibility: compute, buffer: { type: 'storage' } },
        { binding: 8, visibility: compute, texture: { sampleType: 'float' } },
        { binding: 9, visibility: compute, texture: { sampleType: 'unfilterable-float' } }
      ]
    })
    this.emptyScratch = device.createBuffer({ label: 'empty scratch', size: 16, usage: GPUBufferUsage.STORAGE })
    this.noMask = device.createTexture({ label: 'no mask', size: [1, 1], format: 'r8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST })
    device.queue.writeTexture({ texture: this.noMask }, new Uint8Array([255]), { bytesPerRow: 1 }, [1, 1])
    this.noPattern = device.createTexture({ label: 'no pattern', size: [1, 1], format: 'r32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST })
    device.queue.writeTexture({ texture: this.noPattern }, new Float32Array([0.5]), { bytesPerRow: 4 }, [1, 1])
    this.pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [this.layout] })
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  }

  private module(def: PassDef<never>): GPUShaderModule {
    let module = this.modules.get(def.id)
    if (!module) {
      module = this.device.createShaderModule({ label: def.id, code: shaderSource(def) })
      module.getCompilationInfo().then((info) => {
        for (const m of info.messages) {
          const log = m.type === 'error' ? console.error : console.warn
          log(`[wgsl:${def.id}] ${m.lineNum}:${m.linePos} ${m.message}`)
        }
      })
      this.modules.set(def.id, module)
    }
    return module
  }

  private pipeline(def: PassDef<never>, entryPoint: 'main' | 'mainRows'): GPUComputePipeline {
    const key = `${def.id}:${entryPoint}`
    let pipeline = this.pipelines.get(key)
    if (!pipeline) {
      pipeline = this.device.createComputePipeline({
        label: key,
        layout: this.pipelineLayout,
        compute: { module: this.module(def), entryPoint }
      })
      this.pipelines.set(key, pipeline)
    }
    return pipeline
  }

  /**
   * Zeroed scratch storage for a serial run of `def` with output `size`, or null when the run
   * needs none. The caller destroys it after submitting.
   */
  createScratch<P>(def: PassDef<P>, params: P, size: Size): GPUBuffer | null {
    if (!def.serial?.(params)) return null
    const bytes = def.scratchBytes?.(size, params) ?? 0
    if (bytes <= 0) return null
    return this.device.createBuffer({
      label: `${def.id} scratch`,
      size: Math.ceil(bytes / 16) * 16,
      usage: GPUBufferUsage.STORAGE
    })
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
        { binding: 6, resource: { buffer: uniforms[1]! } },
        { binding: 7, resource: { buffer: bindings.scratch ?? this.emptyScratch } },
        { binding: 8, resource: (bindings.mask ?? this.noMask).createView() },
        { binding: 9, resource: (bindings.customPattern ?? this.noPattern).createView() }
      ]
    })
    const pass = encoder.beginComputePass({ label: def.id })
    pass.setBindGroup(0, bindGroup)
    if (bindings.serial) {
      pass.setPipeline(this.pipeline(def, 'mainRows'))
      pass.dispatchWorkgroups(1)
    } else {
      pass.setPipeline(this.pipeline(def, 'main'))
      pass.dispatchWorkgroups(Math.ceil(output.width / WORKGROUP), Math.ceil(output.height / WORKGROUP))
    }
    pass.end()
  }
}
