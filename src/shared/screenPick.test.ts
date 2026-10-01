import { describe, expect, it } from 'vitest'
import { bgraToRgba, captureHexAt, isHexColor, matchSources, physicalSize } from './screenPick'

describe('screen pick helpers', () => {
  const capture = { width: 2, height: 2, bgra: new Uint8Array([0x34, 0xab, 0x12, 255, 0, 0, 0, 255, 1, 2, 3, 255, 0xff, 0xff, 0xff, 255]) }

  it('reads BGRA pixels as hex', () => {
    expect(captureHexAt(capture, 0, 0)).toBe('#12ab34')
    expect(captureHexAt(capture, 0.9, 1.5)).toBe('#030201')
    expect(captureHexAt(capture, 5, 5)).toBe('#ffffff')
    expect(captureHexAt(capture, -3, 0)).toBe('#12ab34')
  })

  it('converts BGRA to opaque RGBA', () => {
    expect([...bgraToRgba(new Uint8Array([1, 2, 3, 0]))]).toEqual([3, 2, 1, 255])
  })

  it('matches sources to displays by id, else by position for sources without one', () => {
    expect(matchSources(['10', '20'], ['20', '10'])).toEqual([1, 0])
    expect(matchSources(['10', '20'], ['', ''])).toEqual([0, 1])
    expect(matchSources(['10', '20'], ['10'])).toEqual([0, -1])
  })

  it('computes device-pixel sizes', () => {
    expect(physicalSize({ size: { width: 1707, height: 960 }, scaleFactor: 1.5 })).toEqual({ width: 2561, height: 1440 })
  })

  it('accepts only #rrggbb', () => {
    expect(isHexColor('#00ff00')).toBe(true)
    expect(isHexColor('#00FF00')).toBe(false)
    expect(isHexColor('red')).toBe(false)
  })
})
