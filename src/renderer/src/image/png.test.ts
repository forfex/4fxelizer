import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { crc32, encodePng } from './png'

/** Test-side decoder: parses chunks, checks CRCs, inflates and un-filters IDAT. */
function decodePng(png: Uint8Array): { width: number; height: number; data: Uint8Array } {
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const view = new DataView(png.buffer, png.byteOffset)
  let offset = 8
  let width = 0
  let height = 0
  const idat: Uint8Array[] = []
  const types: string[] = []
  while (offset < png.length) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8))
    const data = png.subarray(offset + 8, offset + 8 + length)
    const crc = view.getUint32(offset + 8 + length)
    expect((crc32(png.subarray(offset + 4, offset + 8 + length)) ^ 0xffffffff) >>> 0).toBe(crc)
    types.push(type)
    if (type === 'IHDR') {
      width = new DataView(data.buffer, data.byteOffset).getUint32(0)
      height = new DataView(data.buffer, data.byteOffset).getUint32(4)
      expect(data[8]).toBe(8)
      expect(data[9]).toBe(6)
    }
    if (type === 'IDAT') idat.push(data)
    offset += 12 + length
  }
  expect(types).toEqual(['IHDR', 'IDAT', 'IEND'])

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * 4
  const out = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i]!
      const a = i >= 4 ? out[y * stride + i - 4]! : 0
      const b = y > 0 ? out[(y - 1) * stride + i]! : 0
      const c = i >= 4 && y > 0 ? out[(y - 1) * stride + i - 4]! : 0
      let p = 0
      if (filter === 1) p = a
      else if (filter === 2) p = b
      else if (filter === 3) p = (a + b) >> 1
      else if (filter === 4) {
        const pp = a + b - c
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c)
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      out[y * stride + i] = (x + p) & 0xff
    }
  }
  return { width, height, data: out }
}

describe('encodePng', () => {
  it('round-trips RGBA exactly, including semi-transparent texels', async () => {
    const width = 37
    const height = 23
    const data = new Uint8Array(width * height * 4)
    for (let i = 0; i < data.length; i++) data[i] = (i * 7919 + (i >> 5) * 31) & 0xff
    const decoded = decodePng(await encodePng({ width, height, data }))
    expect(decoded.width).toBe(width)
    expect(decoded.height).toBe(height)
    expect(decoded.data).toEqual(data)
  })

  it('handles a 1x1 image', async () => {
    const data = new Uint8Array([10, 20, 30, 40])
    expect(decodePng(await encodePng({ width: 1, height: 1, data })).data).toEqual(data)
  })

  it('rejects mismatched sizes', async () => {
    await expect(encodePng({ width: 2, height: 2, data: new Uint8Array(4) })).rejects.toThrow()
  })
})
