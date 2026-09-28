import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { countColors, IndexedExportError, toIndexed } from './indexed'
import { encodeIndexedPng, indexedBitDepth, type RgbaImage } from './png'

function rgba(width: number, height: number, pixels: number[][]): RgbaImage {
  return { width, height, data: new Uint8Array(pixels.flat()) }
}

/** Test-side decoder for indexed PNGs: returns chunks and unpacked indices. */
function decodeIndexed(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset)
  let offset = 8
  const chunks: Record<string, Uint8Array> = {}
  const idat: Uint8Array[] = []
  const order: string[] = []
  while (offset < png.length) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8))
    const data = png.subarray(offset + 8, offset + 8 + length)
    order.push(type)
    if (type === 'IDAT') idat.push(data)
    else chunks[type] = data
    offset += 12 + length
  }
  const ihdr = new DataView(chunks.IHDR!.buffer, chunks.IHDR!.byteOffset)
  const width = ihdr.getUint32(0)
  const height = ihdr.getUint32(4)
  const depth = chunks.IHDR![8]!
  expect(chunks.IHDR![9]).toBe(3)
  const raw = inflateSync(Buffer.concat(idat))
  const stride = Math.ceil((width * depth) / 8)
  const indices: number[] = []
  for (let y = 0; y < height; y++) {
    expect(raw[y * (stride + 1)]).toBe(0)
    for (let x = 0; x < width; x++) {
      const bit = x * depth
      const byte = raw[y * (stride + 1) + 1 + (bit >> 3)]!
      indices.push((byte >> (8 - depth - (bit & 7))) & ((1 << depth) - 1))
    }
  }
  return { order, depth, plte: chunks.PLTE, trns: chunks.tRNS, indices }
}

describe('toIndexed', () => {
  it('puts transparency at index 0 and sorts image colors dark to light', () => {
    const img = rgba(2, 2, [[255, 255, 255, 255], [9, 9, 9, 0], [0, 0, 0, 255], [200, 0, 0, 0]])
    const out = toIndexed(img)
    expect(out.palette).toEqual([[0, 0, 0, 0], [0, 0, 0, 255], [255, 255, 255, 255]])
    expect([...out.indices]).toEqual([2, 0, 1, 0])
  })

  it('keeps a given palette in order, unused colors included', () => {
    const img = rgba(2, 1, [[0, 255, 0, 255], [255, 0, 0, 255]])
    const out = toIndexed(img, ['#ff0000', '#0000ff', '#00ff00'])
    expect(out.palette.map((e) => e.slice(0, 3))).toEqual([[255, 0, 0], [0, 0, 255], [0, 255, 0]])
    expect([...out.indices]).toEqual([2, 0])
  })

  it('rejects colors outside the given palette', () => {
    expect(() => toIndexed(rgba(1, 1, [[1, 2, 3, 255]]), ['#000000'])).toThrow(IndexedExportError)
  })

  it('rejects more than 256 colors', () => {
    const pixels = Array.from({ length: 300 }, (_, i) => [i & 255, i >> 8, 0, 255])
    expect(() => toIndexed(rgba(300, 1, pixels))).toThrow(/300 colors/)
  })

  it('counts colors', () => {
    expect(countColors(rgba(3, 1, [[1, 1, 1, 255], [1, 1, 1, 255], [5, 5, 5, 0]]))).toBe(2)
  })
})

describe('encodeIndexedPng', () => {
  it('picks the smallest bit depth', () => {
    expect([2, 3, 4, 5, 16, 17, 256].map(indexedBitDepth)).toEqual([1, 2, 2, 4, 4, 8, 8])
  })

  for (const colors of [2, 4, 16, 256]) {
    it(`round-trips ${colors} colors`, async () => {
      const width = 7
      const height = 5
      const palette = Array.from({ length: colors }, (_, i) => [i, 255 - i, i, 255] as [number, number, number, number])
      const indices = new Uint8Array(width * height).map((_, i) => (i * 7) % colors)
      const png = await encodeIndexedPng({ width, height, indices, palette })
      const decoded = decodeIndexed(png)
      expect(decoded.order).toEqual(['IHDR', 'PLTE', 'IDAT', 'IEND'])
      expect(decoded.depth).toBe(indexedBitDepth(colors))
      expect(decoded.indices).toEqual([...indices])
      expect([...decoded.plte!]).toEqual(palette.flatMap(([r, g, b]) => [r, g, b]))
    })
  }

  it('writes tRNS up to the last translucent entry', async () => {
    const palette: [number, number, number, number][] = [[0, 0, 0, 0], [1, 1, 1, 128], [2, 2, 2, 255]]
    const decoded = decodeIndexed(await encodeIndexedPng({ width: 1, height: 1, indices: new Uint8Array([2]), palette }))
    expect(decoded.order).toEqual(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'])
    expect([...decoded.trns!]).toEqual([0, 128])
  })
})
