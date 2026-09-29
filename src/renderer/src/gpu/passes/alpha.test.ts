import { describe, expect, it } from 'vitest'
import { initialDoc, makeStage } from '@/stack/doc'
import { parsePreset, serializePreset } from '@/stack/preset'
import { downscale, DEFAULT_DOWNSCALE, type DownscaleParams } from './downscale'
import { upscale, DEFAULT_UPSCALE, type UpscaleParams } from './upscale'

const words = (buffer: ArrayBuffer | Float32Array): DataView =>
  buffer instanceof ArrayBuffer ? new DataView(buffer) : new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

describe('separate alpha filters', () => {
  it('pack the alpha mode and threshold', () => {
    const down = words(downscale.pack!({ ...DEFAULT_DOWNSCALE, alpha: 'cutout', alphaThreshold: 0.25 }))
    expect(down.getUint32(12, true)).toBe(3)
    expect(down.getFloat32(16, true)).toBe(0.25)
    const up = words(upscale.pack!({ ...DEFAULT_UPSCALE, alpha: 'source', alphaThreshold: 0.75 }))
    expect(up.getUint32(8, true)).toBe(4)
    expect(up.getFloat32(12, true)).toBe(0.75)
  })

  it('fall back to the color filter for unknown modes', () => {
    expect(words(downscale.pack!({ ...DEFAULT_DOWNSCALE, alpha: 'bogus' as never })).getUint32(12, true)).toBe(0)
    expect(words(upscale.pack!({ ...DEFAULT_UPSCALE, alpha: 'bogus' as never })).getUint32(8, true)).toBe(0)
  })

  it('old presets without them filter alpha with the color', () => {
    const doc = initialDoc()
    doc.stages.push(makeStage('upscale').stage)
    const raw = JSON.parse(serializePreset(doc, 'Old'), (key, value) => (key === 'alpha' || key === 'alphaThreshold' ? undefined : value))
    const loaded = parsePreset(JSON.stringify(raw)).doc
    const params = (passId: string): unknown => loaded.stages.find((s) => s.passId === passId)!.params
    expect((params('downscale') as DownscaleParams).alpha).toBe('same')
    expect((params('upscale') as UpscaleParams).alpha).toBe('same')
  })
})
