import { describe, expect, it } from 'vitest'
import { decodePattern, encodePattern, MAX_PATTERN_SIDE, patternFromRgba, patternThresholds } from './customPattern'

describe('custom dither patterns', () => {
  it('round-trips through the params string and rejects broken ones', () => {
    const pattern = { width: 3, height: 2, gray: new Uint8Array([0, 10, 255, 128, 7, 99]) }
    const encoded = encodePattern(pattern)
    expect(encoded.startsWith('3x2:')).toBe(true)
    expect(decodePattern(encoded)).toEqual(pattern)
    expect(decodePattern('')).toBeNull()
    expect(decodePattern('3x3:' + encoded.slice(4))).toBeNull() // wrong length
    expect(decodePattern(`${MAX_PATTERN_SIDE + 1}x1:AA==`)).toBeNull()
    expect(decodePattern('2x1:!!')).toBeNull()
  })

  it('reads gray from RGBA and refuses large images', () => {
    const image = { width: 2, height: 1, data: new Uint8Array([255, 255, 255, 0, 255, 0, 0, 255]) }
    expect([...patternFromRgba(image).gray]).toEqual([255, 54])
    expect(() => patternFromRgba({ width: MAX_PATTERN_SIDE + 1, height: 1, data: new Uint8Array((MAX_PATTERN_SIDE + 1) * 4) })).toThrow()
  })

  it('turns grays into evenly spread rank thresholds, ties sharing a rank', () => {
    expect([...patternThresholds(new Uint8Array([200, 10, 90, 40]))]).toEqual([0.875, 0.125, 0.625, 0.375])
    // A two-tone image acts like a checker: half the pixels switch at 1/4, the rest at 3/4.
    expect([...patternThresholds(new Uint8Array([0, 255, 255, 0]))]).toEqual([0.25, 0.75, 0.75, 0.25])
  })
})
