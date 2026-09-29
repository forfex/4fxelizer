// Stage masks: a grayscale texture (1 = full effect) built on the GPU before a stage runs and bound
// to it as `maskTex`. A mask combines up to two sources, each derived from the stage's input
// (edges, tones, saturation) or read from an imported map (AO, cavity, …), then gets blurred.
// Maps are sampled in normalized UV, so they line up at any resolution in the stack.

import { MAP_CHANNELS, MAP_SLOTS, type MapChannel, type MapSlot } from '@shared/maps'
import { WGSL_COLOR } from './wgslLib'
import { WORK_FORMAT, packStruct, type Size } from './pass'

/** Mask sources. Append new texture-derived entries before the maps: a source's position is its shader index. */
export const MASK_SOURCES = [
  { id: 'none', label: 'Everywhere', hint: 'No mask.', group: undefined },
  { id: 'edges', label: 'Edges', hint: 'Edges and detail.', group: 'From the image' },
  { id: 'flats', label: 'Flats', hint: 'Smooth, flat areas (gradients), away from edges.', group: 'From the image' },
  { id: 'shadows', label: 'Shadows', hint: 'Dark areas.', group: 'From the image' },
  { id: 'midtones', label: 'Midtones', hint: 'Mid-brightness areas.', group: 'From the image' },
  { id: 'highlights', label: 'Highlights', hint: 'Bright areas.', group: 'From the image' },
  { id: 'saturated', label: 'Saturated', hint: 'Colorful areas.', group: 'From the image' },
  { id: 'grays', label: 'Grays', hint: 'Gray, desaturated areas.', group: 'From the image' },
  ...MAP_SLOTS.map((m) => ({ id: `map-${m.id}` as const, label: `${m.label} map`, hint: `${m.hint} From the imported map (Maps panel).`, group: 'Imported maps' }))
] as const

export type MaskSource = (typeof MASK_SOURCES)[number]['id']

/** Shader index of the first map source; sources from here on read `mapA` / `mapB`. */
const FIRST_MAP = MASK_SOURCES.findIndex((s) => s.id.startsWith('map-'))

export const MASK_COMBINE = [
  { id: 'multiply', label: 'Multiply', hint: 'Only where both masks are white.' },
  { id: 'add', label: 'Add', hint: 'Where either mask is white; overlaps add up.' },
  { id: 'min', label: 'Min', hint: 'The darker of the two masks.' },
  { id: 'max', label: 'Max', hint: 'The brighter of the two masks.' }
] as const

export type MaskCombine = (typeof MASK_COMBINE)[number]['id']

/** Most blur radius in pixels. */
export const MAX_MASK_BLUR = 32

export interface MaskSpec {
  a: MaskSource
  aInvert: boolean
  /** How much the first source counts: 0 = none (white), 1 = fully (default). */
  aAmount?: number
  /** Second source combined with the first ('none' = only the first). */
  b: MaskSource
  bInvert: boolean
  /** How much the second source counts (see aAmount). */
  bAmount?: number
  combine: MaskCombine
  /** Blur radius in pixels of the stage's image. */
  blur: number
  /** Edge detection and blur wrap around the image edges (tiling textures). */
  wrap: boolean
}

/** A mask with no sources, the starting point for editing one. */
export const EMPTY_MASK: MaskSpec = { a: 'none', aInvert: false, b: 'none', bInvert: false, combine: 'multiply', blur: 0, wrap: false }

/**
 * A mask as stored: null when it has no source, and a lone second source moves to the first slot.
 */
export function normalizeMask(spec: MaskSpec): MaskSpec | null {
  if (spec.a === 'none' && spec.b === 'none') return null
  if (spec.a !== 'none') return spec
  return { ...spec, a: spec.b, aInvert: spec.bInvert, aAmount: spec.bAmount, b: 'none', bInvert: false, bAmount: undefined }
}

/** The map slot a source reads, if any. */
export function maskMapSlot(source: MaskSource): MapSlot | null {
  return source.startsWith('map-') ? (source.slice(4) as MapSlot) : null
}

/** Map slots a mask reads. */
export function maskMaps(spec: MaskSpec): MapSlot[] {
  return [spec.a, spec.b].map(maskMapSlot).filter((s): s is MapSlot => !!s)
}

/** A loaded map as the mask builder reads it. */
export interface MaskMap {
  texture: GPUTexture
  channel: MapChannel
}

const index = <T extends { id: string }>(list: readonly T[], id: string): number => Math.max(0, list.findIndex((d) => d.id === id))

const BUILD_WGSL = /* wgsl */ `
struct Params {
  a: u32, b: u32, aInvert: u32, bInvert: u32,
  aChannel: u32, bChannel: u32, combine: u32, wrap: u32,
  aAmount: f32, bAmount: f32, _p0: u32, _p1: u32,
}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<${WORK_FORMAT}, write>;
@group(0) @binding(2) var<uniform> params: Params;
@group(0) @binding(3) var clampSampler: sampler;
@group(0) @binding(4) var repeatSampler: sampler;
@group(0) @binding(5) var mapA: texture_2d<f32>;
@group(0) @binding(6) var mapB: texture_2d<f32>;

const FIRST_MAP = ${FIRST_MAP}u;

${WGSL_COLOR}

fn srcAt(q: vec2i) -> vec4f {
  let n = vec2i(textureDimensions(src));
  var c = clamp(q, vec2i(0), n - 1);
  if (params.wrap == 1u) { c = ((q % n) + n) % n; }
  return textureLoad(src, c, 0);
}

fn lightAt(q: vec2i) -> f32 { return rgbToOklab(srcAt(q).rgb).x; }

/** Sobel edge strength of the input's lightness around input texel c. */
fn edge(c: vec2i) -> f32 {
  let tl = lightAt(c + vec2i(-1, -1));
  let t = lightAt(c + vec2i(0, -1));
  let tr = lightAt(c + vec2i(1, -1));
  let l = lightAt(c + vec2i(-1, 0));
  let r = lightAt(c + vec2i(1, 0));
  let bl = lightAt(c + vec2i(-1, 1));
  let b = lightAt(c + vec2i(0, 1));
  let br = lightAt(c + vec2i(1, 1));
  let gx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
  let gy = (bl + 2.0 * b + br) - (tl + 2.0 * t + tr);
  return clamp(length(vec2f(gx, gy)), 0.0, 1.0);
}

fn channelOf(c: vec4f, channel: u32) -> f32 {
  switch channel {
    case 1u: { return c.r; }
    case 2u: { return c.g; }
    case 3u: { return c.b; }
    case 4u: { return c.a; }
    default: { return luma(c.rgb); }
  }
}

fn mapValue(map: texture_2d<f32>, uv: vec2f, channel: u32) -> f32 {
  if (params.wrap == 1u) { return channelOf(textureSampleLevel(map, repeatSampler, uv, 0.0), channel); }
  return channelOf(textureSampleLevel(map, clampSampler, uv, 0.0), channel);
}

/** 0..1 value of source \`kind\` at uv (input texel q). */
fn sourceValue(kind: u32, q: vec2i, uv: vec2f, map: texture_2d<f32>, channel: u32) -> f32 {
  if (kind >= FIRST_MAP) { return mapValue(map, uv, channel); }
  if (kind == 1u) { return edge(q); }
  if (kind == 2u) { return 1.0 - edge(q); }
  let lab = rgbToOklab(srcAt(q).rgb);
  let chroma = clamp(length(lab.yz) / 0.2, 0.0, 1.0);
  switch kind {
    case 3u: { return 1.0 - lab.x; }
    case 4u: { return 1.0 - abs(2.0 * lab.x - 1.0); }
    case 5u: { return lab.x; }
    case 6u: { return chroma; }
    case 7u: { return 1.0 - chroma; }
    default: { return 1.0; }
  }
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let uv = (vec2f(id.xy) + 0.5) / vec2f(size);
  let q = vec2i(uv * vec2f(textureDimensions(src)));
  var m = 1.0;
  if (params.a != 0u) {
    m = clamp(sourceValue(params.a, q, uv, mapA, params.aChannel), 0.0, 1.0);
    if (params.aInvert == 1u) { m = 1.0 - m; }
    m = mix(1.0, m, params.aAmount);
  }
  if (params.b != 0u) {
    var v = clamp(sourceValue(params.b, q, uv, mapB, params.bChannel), 0.0, 1.0);
    if (params.bInvert == 1u) { v = 1.0 - v; }
    v = mix(1.0, v, params.bAmount);
    switch params.combine {
      case 1u: { m = min(m + v, 1.0); }
      case 2u: { m = min(m, v); }
      case 3u: { m = max(m, v); }
      default: { m = m * v; }
    }
  }
  textureStore(dst, id.xy, vec4f(m, m, m, 1.0));
}
`

const BLUR_WGSL = /* wgsl */ `
struct Params { radius: f32, vertical: u32, wrap: u32, _pad: u32 }

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<${WORK_FORMAT}, write>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = vec2i(textureDimensions(dst));
  let p = vec2i(id.xy);
  if (p.x >= size.x || p.y >= size.y) { return; }
  let dir = select(vec2i(1, 0), vec2i(0, 1), params.vertical == 1u);
  let taps = i32(ceil(params.radius));
  let sigma = max(params.radius * 0.5, 0.5);
  var sum = 0.0;
  var weight = 0.0;
  for (var i = -taps; i <= taps; i++) {
    var q = p + dir * i;
    if (params.wrap == 1u) { q = ((q % size) + size) % size; } else { q = clamp(q, vec2i(0), size - 1); }
    let w = exp(-f32(i * i) / (2.0 * sigma * sigma));
    sum += textureLoad(src, q, 0).r * w;
    weight += w;
  }
  let m = sum / weight;
  textureStore(dst, id.xy, vec4f(m, m, m, 1.0));
}
`

/** Textures and buffers of one mask build, freed after the work using them is submitted. */
export interface MaskBuild {
  texture: GPUTexture
  release(): void
}

export class MaskBuilder {
  private readonly build: GPUComputePipeline
  private readonly blur: GPUComputePipeline
  private readonly clampSampler: GPUSampler
  private readonly repeatSampler: GPUSampler
  /** Bound for missing maps. */
  private readonly white: GPUTexture

  constructor(private readonly device: GPUDevice) {
    const pipeline = (label: string, code: string): GPUComputePipeline => {
      const module = device.createShaderModule({ label, code })
      module.getCompilationInfo().then((info) => {
        for (const m of info.messages) (m.type === 'error' ? console.error : console.warn)(`[wgsl:${label}] ${m.lineNum}:${m.linePos} ${m.message}`)
      })
      return device.createComputePipeline({ label, layout: 'auto', compute: { module, entryPoint: 'main' } })
    }
    this.build = pipeline('mask', BUILD_WGSL)
    this.blur = pipeline('mask blur', BLUR_WGSL)
    this.clampSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
    this.repeatSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat' })
    this.white = device.createTexture({ label: 'white', size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST })
    device.queue.writeTexture({ texture: this.white }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1])
  }

  private texture(size: Size): GPUTexture {
    return this.device.createTexture({
      label: 'mask',
      size: [Math.max(1, size.width), Math.max(1, size.height)],
      format: WORK_FORMAT,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
    })
  }

  private uniform(data: ArrayBuffer): GPUBuffer {
    const buffer = this.device.createBuffer({ label: 'mask params', size: data.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.device.queue.writeBuffer(buffer, 0, data)
    return buffer
  }

  /**
   * Encodes building the mask of `spec` for a stage with input `input` and output `size`.
   * `maps` has the loaded maps by slot; a source whose map isn't loaded counts as no mask.
   */
  encode(encoder: GPUCommandEncoder, input: GPUTexture, size: Size, spec: MaskSpec, maps: (slot: MapSlot) => MaskMap | null): MaskBuild {
    const resources: { destroy(): void }[] = []
    const source = (s: MaskSource): { kind: number; map: MaskMap | null } => {
      const slot = maskMapSlot(s)
      const map = slot ? maps(slot) : null
      return { kind: slot && !map ? 0 : index(MASK_SOURCES, s), map }
    }
    const a = source(spec.a)
    const b = source(spec.b)
    const channel = (m: MaskMap | null): number => index(MAP_CHANNELS, m?.channel ?? 'luma')
    const params = this.uniform(
      packStruct(
        ['u', a.kind],
        ['u', b.kind],
        ['u', spec.aInvert ? 1 : 0],
        ['u', spec.bInvert ? 1 : 0],
        ['u', channel(a.map)],
        ['u', channel(b.map)],
        ['u', index(MASK_COMBINE, spec.combine)],
        ['u', spec.wrap ? 1 : 0],
        ['f', Math.min(Math.max(spec.aAmount ?? 1, 0), 1)],
        ['f', Math.min(Math.max(spec.bAmount ?? 1, 0), 1)],
        ['u', 0],
        ['u', 0]
      )
    )
    let texture = this.texture(size)
    resources.push(params)
    const groups = (w: number, h: number): [number, number] => [Math.ceil(w / 8), Math.ceil(h / 8)]

    const pass = encoder.beginComputePass({ label: 'mask' })
    pass.setPipeline(this.build)
    pass.setBindGroup(
      0,
      this.device.createBindGroup({
        layout: this.build.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: input.createView() },
          { binding: 1, resource: texture.createView() },
          { binding: 2, resource: { buffer: params } },
          { binding: 3, resource: this.clampSampler },
          { binding: 4, resource: this.repeatSampler },
          { binding: 5, resource: (a.map?.texture ?? this.white).createView() },
          { binding: 6, resource: (b.map?.texture ?? this.white).createView() }
        ]
      })
    )
    pass.dispatchWorkgroups(...groups(texture.width, texture.height))

    const radius = Math.min(Math.max(spec.blur, 0), MAX_MASK_BLUR)
    if (radius > 0) {
      for (const vertical of [0, 1]) {
        const out = this.texture(size)
        const blurParams = this.uniform(packStruct(['f', radius], ['u', vertical], ['u', spec.wrap ? 1 : 0], ['u', 0]))
        resources.push(texture, blurParams)
        pass.setPipeline(this.blur)
        pass.setBindGroup(
          0,
          this.device.createBindGroup({
            layout: this.blur.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: texture.createView() },
              { binding: 1, resource: out.createView() },
              { binding: 2, resource: { buffer: blurParams } }
            ]
          })
        )
        pass.dispatchWorkgroups(...groups(out.width, out.height))
        texture = out
      }
    }
    pass.end()
    const result = texture
    return {
      texture: result,
      release: () => {
        for (const r of resources) r.destroy()
        result.destroy()
      }
    }
  }

  dispose(): void {
    this.white.destroy()
  }
}
