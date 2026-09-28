import { describe, expect, it } from 'vitest'
import { halfToFloat, halfToUnorm8Lut, rgba16fRowsToRgba8 } from './half'

describe('half floats', () => {
  it('decodes known values', () => {
    expect(halfToFloat(0x0000)).toBe(0)
    expect(halfToFloat(0x3c00)).toBe(1)
    expect(halfToFloat(0x3800)).toBe(0.5)
    expect(halfToFloat(0xc000)).toBe(-2)
    expect(halfToFloat(0x7c00)).toBe(Infinity)
    expect(halfToFloat(0x7e00)).toBeNaN()
  })

  it('maps to clamped 8-bit unorm', () => {
    const lut = halfToUnorm8Lut()
    expect(lut[0x3c00]).toBe(255)
    expect(lut[0x3800]).toBe(128)
    expect(lut[0xc000]).toBe(0) // negative clamps to 0
    expect(lut[0x4000]).toBe(255) // 2.0 clamps to 1
  })

  it('every 8-bit value survives a round trip through half precision', () => {
    // Guards the upload → rgba16float → readback path used for export.
    const lut = halfToUnorm8Lut()
    const f32 = new Float32Array(1)
    const u32 = new Uint32Array(f32.buffer)
    for (let v = 0; v < 256; v++) {
      f32[0] = v / 255
      // float32 → half, round-to-nearest (normal range only; enough for [0,1])
      const bits = u32[0]!
      const exp = ((bits >> 23) & 0xff) - 127 + 15
      let half = v === 0 ? 0 : (exp << 10) | ((bits >> 13) & 0x3ff)
      if (v !== 0 && bits & 0x1000) half++
      expect(lut[half]).toBe(v)
    }
  })

  it('strips row padding', () => {
    const src = new Uint16Array([0x3c00, 0, 0, 0x3c00, 0xdead, 0xbeef, 0x3800, 0x3800, 0x3800, 0x3c00, 0, 0])
    // 1 pixel wide, 2 rows, 12 bytes per row (8 used + 4 padding) — laid out as halves
    const out = rgba16fRowsToRgba8(src, 1, 2, 12)
    expect([...out]).toEqual([255, 0, 0, 255, 128, 128, 128, 255])
  })
})
