import type { RendererGpuReport } from '@shared/api'
import { adapterLabel, initGpu, type Gpu } from './device'
import { PassChain } from './chain'
import { PassRunner } from './pass'
import { PASSES } from './passes'
import { posterizeCpu } from './passes/posterize'
import { readTextureRgba8, uploadBitmap } from './textureIO'

const REPORTED_LIMITS = [
  'maxTextureDimension2D',
  'maxBufferSize',
  'maxStorageBufferBindingSize',
  'maxComputeWorkgroupStorageSize',
  'maxComputeInvocationsPerWorkgroup',
  'maxComputeWorkgroupSizeX',
  'maxStorageTexturesPerShaderStage'
] as const

/**
 * End-to-end check of the real image path: ImageBitmap upload (with a semi-transparent
 * texel, to catch premultiplication), a compute pass through the chain, and readback.
 */
export async function smokeTest(gpu: Gpu): Promise<{ ok: boolean; detail: string }> {
  const input = [
    [77, 179, 128, 255],
    [10, 250, 60, 128],
    [255, 0, 200, 0],
    [128, 128, 128, 255]
  ]
  const levels = 2
  const bitmap = await createImageBitmap(new ImageData(new Uint8ClampedArray(input.flat()), 2, 2), {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none'
  })
  const source = uploadBitmap(gpu.device, bitmap, 'smoke source')
  const chain = new PassChain(gpu.device, new PassRunner(gpu.device), PASSES)
  try {
    const { output } = chain.run({ key: 'smoke', texture: source }, [
      { uid: 'p', passId: 'posterize', params: { levels }, enabled: true }
    ])
    const result = await readTextureRgba8(gpu.device, output)
    const expected = input.flatMap(([r, g, b, a]) => [...[r!, g!, b!].map((v) => posterizeCpu(v, levels)), a!])
    const actual = [...result.data]
    // The fully transparent texel's RGB may legitimately differ (some decoders zero it).
    const ignored = (i: number): boolean => i >= 8 && i < 11
    const mismatch = expected.findIndex((v, i) => !ignored(i) && v !== actual[i])
    return mismatch === -1
      ? { ok: true, detail: 'upload → compute → readback matches CPU reference' }
      : { ok: false, detail: `mismatch at byte ${mismatch}: expected ${expected} got ${actual}` }
  } finally {
    chain.dispose()
    source.destroy()
  }
}

export async function collectGpuReport(existing?: Gpu): Promise<RendererGpuReport> {
  let gpu: Gpu
  try {
    gpu = existing ?? (await initGpu())
  } catch (e) {
    return { webgpu: false, error: (e as Error).message }
  }
  const { adapter } = gpu
  const info = adapter.info
  const report: RendererGpuReport = {
    webgpu: true,
    adapter: {
      vendor: info.vendor,
      architecture: info.architecture,
      device: info.device,
      description: info.description || adapterLabel(adapter)
    },
    features: [...adapter.features].sort(),
    limits: Object.fromEntries(REPORTED_LIMITS.map((k) => [k, adapter.limits[k]])),
    preferredCanvasFormat: navigator.gpu.getPreferredCanvasFormat()
  }
  try {
    report.smokeTest = await smokeTest(gpu)
  } catch (e) {
    report.smokeTest = { ok: false, detail: (e as Error).message }
  }
  if (!existing) gpu.device.destroy()
  return report
}
