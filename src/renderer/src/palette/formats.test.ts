import { describe, expect, it } from 'vitest'
import { exportPalette, parsePaletteFile } from './formats'

const colors = ['#000000', '#ff8000', '#12abef']
const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

describe('palette formats', () => {
  for (const format of ['hex', 'gpl', 'pal', 'act'] as const) {
    it(`round-trips .${format}`, () => {
      const bytes = exportPalette('Test', colors, format)
      expect(parsePaletteFile(`x.${format}`, bytes).colors).toEqual(colors)
    })
  }

  it('reads the GIMP palette name', () => {
    expect(parsePaletteFile('a.gpl', exportPalette('My Pal', colors, 'gpl')).name).toBe('My Pal')
  })

  it('reads Lospec-style .hex files with blank lines and case', () => {
    expect(parsePaletteFile('a.hex', enc('FF0000\r\n\r\n00ff00\n')).colors).toEqual(['#ff0000', '#00ff00'])
  })

  it('reads a full 256-color .act without a count', () => {
    const bytes = new Uint8Array(768)
    bytes.set([1, 2, 3], 3)
    const parsed = parsePaletteFile('a.act', bytes)
    expect(parsed.colors).toHaveLength(256)
    expect(parsed.colors[1]).toBe('#010203')
  })

  it('reads RIFF .pal', () => {
    const count = 2
    const dataSize = 4 + count * 4
    const bytes = new Uint8Array(12 + 8 + dataSize)
    const view = new DataView(bytes.buffer)
    bytes.set(enc('RIFF'), 0)
    view.setUint32(4, bytes.length - 8, true)
    bytes.set(enc('PAL data'), 8)
    view.setUint32(16, dataSize, true)
    view.setUint16(20, 0x300, true)
    view.setUint16(22, count, true)
    bytes.set([255, 0, 0, 0, 0, 0, 255, 0], 24)
    expect(parsePaletteFile('a.pal', bytes).colors).toEqual(['#ff0000', '#0000ff'])
  })

  it('reads ASE RGB swatches', () => {
    const name = 'A'
    const blockLen = 2 + (name.length + 1) * 2 + 4 + 12 + 2
    const bytes = new Uint8Array(12 + 6 + blockLen)
    const view = new DataView(bytes.buffer)
    bytes.set(enc('ASEF'), 0)
    view.setUint16(4, 1)
    view.setUint32(8, 1)
    view.setUint16(12, 1)
    view.setUint32(14, blockLen)
    view.setUint16(18, name.length + 1)
    view.setUint16(20, 'A'.charCodeAt(0))
    bytes.set(enc('RGB '), 24)
    view.setFloat32(28, 1)
    view.setFloat32(32, 0.5)
    view.setFloat32(36, 0)
    expect(parsePaletteFile('a.ase', bytes).colors).toEqual(['#ff8000'])
  })

  it('rejects unknown formats', () => {
    expect(() => parsePaletteFile('a.xyz', enc(''))).toThrow(/Unsupported/)
  })
})
