import { describe, expect, it } from 'vitest'
import { snapHexTo15bit, rgb8ToHex } from '@/palette/palette'
import { psxChecks, psxStats, type PsxInput } from './psx'

const image = (pixels: number[][]) => ({ width: pixels.length, height: 1, data: new Uint8Array(pixels.flat()) })

const fits: PsxInput = { width: 128, height: 64, colors: 16, transparent: false, translucent: false, off15bit: 0, opaqueBlack: false }

describe('psxStats', () => {
  it('counts colors that are not exact 15-bit colors', () => {
    const stats = psxStats(image([[255, 8, 16, 255], [255, 9, 16, 255], [255, 9, 16, 255], [1, 2, 3, 0]]))
    expect(stats).toEqual({ off15bit: 1, opaqueBlack: false })
  })

  it('agrees with snapHexTo15bit', () => {
    for (let v = 0; v < 256; v++) {
      const exact = snapHexTo15bit(rgb8ToHex(v, v, v)) === rgb8ToHex(v, v, v)
      expect(psxStats(image([[v, v, v, 255]])).off15bit).toBe(exact ? 0 : 1)
    }
  })

  it('finds opaque pure black but ignores transparent black', () => {
    expect(psxStats(image([[0, 0, 0, 0]])).opaqueBlack).toBe(false)
    expect(psxStats(image([[0, 0, 0, 255]])).opaqueBlack).toBe(true)
  })
})

describe('psxChecks', () => {
  it('passes a 4-bit texture that fits', () => {
    const checks = psxChecks(fits)
    expect(checks.every((c) => c.state === 'ok')).toBe(true)
    expect(checks[1]!.text).toContain('4-bit')
  })

  it('fails textures larger than a texture page and warns about non-power-of-two sizes', () => {
    expect(psxChecks({ ...fits, width: 512 })[0]!.state).toBe('fail')
    expect(psxChecks({ ...fits, width: 100 })[0]!.state).toBe('warn')
  })

  it('picks the CLUT depth from the color count', () => {
    expect(psxChecks({ ...fits, colors: 200 })[1]!.text).toContain('8-bit')
    expect(psxChecks({ ...fits, colors: 257 })[1]!.state).toBe('warn')
  })

  it('warns about off-15-bit colors, translucency and opaque black', () => {
    const states = psxChecks({ ...fits, off15bit: 3, translucent: true, opaqueBlack: true }).map((c) => c.state)
    expect(states).toEqual(['ok', 'ok', 'warn', 'warn', 'warn'])
  })
})
