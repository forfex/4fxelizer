import { describe, expect, it } from 'vitest'
import { toIndexed } from './indexed'
import { decodeTga, encodeIndexedTga, encodeTga } from './tga'

function header(opts: {
  type: number
  width: number
  height: number
  depth: number
  descriptor?: number
  cmap?: { length: number; depth: number }
}): number[] {
  const h = new Array(18).fill(0)
  h[1] = opts.cmap ? 1 : 0
  h[2] = opts.type
  if (opts.cmap) {
    h[5] = opts.cmap.length & 0xff
    h[6] = opts.cmap.length >> 8
    h[7] = opts.cmap.depth
  }
  h[12] = opts.width
  h[14] = opts.height
  h[16] = opts.depth
  h[17] = opts.descriptor ?? 0
  return h
}

const px = (img: { data: Uint8Array }, i: number): number[] => [...img.data.subarray(i * 4, i * 4 + 4)]

describe('decodeTga', () => {
  it('decodes 24-bit bottom-up truecolor and flips to top-down', () => {
    // BGR; bottom row first: bottom = red, top = blue
    const bytes = new Uint8Array([...header({ type: 2, width: 1, height: 2, depth: 24 }), 0, 0, 255, 255, 0, 0])
    const img = decodeTga(bytes)
    expect(px(img, 0)).toEqual([0, 0, 255, 255])
    expect(px(img, 1)).toEqual([255, 0, 0, 255])
  })

  it('keeps real 32-bit alpha, top-left origin', () => {
    const bytes = new Uint8Array([
      ...header({ type: 2, width: 2, height: 1, depth: 32, descriptor: 0x28 }),
      10, 20, 30, 128,
      1, 2, 3, 0
    ])
    const img = decodeTga(bytes)
    expect(px(img, 0)).toEqual([30, 20, 10, 128])
    expect(px(img, 1)).toEqual([3, 2, 1, 0])
  })

  it('treats an all-zero 32-bit alpha channel as opaque', () => {
    const bytes = new Uint8Array([...header({ type: 2, width: 1, height: 1, depth: 32 }), 1, 2, 3, 0])
    expect(px(decodeTga(bytes), 0)).toEqual([3, 2, 1, 255])
  })

  it('decodes RLE with run and raw packets', () => {
    const bytes = new Uint8Array([
      ...header({ type: 10, width: 4, height: 1, depth: 24, descriptor: 0x20 }),
      0x82, 0, 255, 0, // run of 3 green
      0x00, 255, 0, 0 // raw 1 blue
    ])
    const img = decodeTga(bytes)
    expect([0, 1, 2].map((i) => px(img, i))).toEqual([[0, 255, 0, 255], [0, 255, 0, 255], [0, 255, 0, 255]])
    expect(px(img, 3)).toEqual([0, 0, 255, 255])
  })

  it('decodes 16-bit ARGB1555 (PSX-style 5:5:5)', () => {
    // r=31, g=0, b=16, alpha bit set
    const v = 0x8000 | (31 << 10) | 16
    const bytes = new Uint8Array([
      ...header({ type: 2, width: 1, height: 1, depth: 16, descriptor: 0x01 }),
      v & 0xff,
      v >> 8
    ])
    expect(px(decodeTga(bytes), 0)).toEqual([255, 0, 132, 255])
  })

  it('decodes color-mapped and grayscale images', () => {
    const mapped = new Uint8Array([
      ...header({ type: 1, width: 2, height: 1, depth: 8, descriptor: 0x20, cmap: { length: 2, depth: 24 } }),
      0, 0, 255, // entry 0: red (BGR)
      255, 0, 0, // entry 1: blue
      1, 0
    ])
    const img = decodeTga(mapped)
    expect(px(img, 0)).toEqual([0, 0, 255, 255])
    expect(px(img, 1)).toEqual([255, 0, 0, 255])

    const gray = new Uint8Array([...header({ type: 3, width: 1, height: 1, depth: 8 }), 77])
    expect(px(decodeTga(gray), 0)).toEqual([77, 77, 77, 255])
  })

  it('rejects truncated files', () => {
    expect(() => decodeTga(new Uint8Array(header({ type: 2, width: 4, height: 4, depth: 24 })))).toThrow()
  })
})

describe('encodeTga', () => {
  const rgba = (pixels: number[][], width: number) => ({
    width,
    height: pixels.length / width,
    data: new Uint8Array(pixels.flat())
  })

  it('round-trips opaque images as 24-bit', () => {
    const img = rgba([[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [10, 20, 30, 255], [1, 2, 3, 255], [200, 100, 50, 255]], 3)
    const bytes = encodeTga(img)
    expect(bytes[16]).toBe(24)
    expect(decodeTga(bytes)).toEqual(img)
  })

  it('keeps straight alpha as 32-bit', () => {
    const img = rgba([[255, 0, 0, 128], [0, 0, 0, 0], [9, 8, 7, 255], [100, 150, 200, 1]], 2)
    const bytes = encodeTga(img)
    expect(bytes[16]).toBe(32)
    expect(bytes[17]! & 0x0f).toBe(8)
    expect(decodeTga(bytes)).toEqual(img)
  })

  it('round-trips indexed images, palette order and transparency included', () => {
    const img = rgba([[0, 0, 0, 0], [255, 0, 0, 255], [0, 255, 0, 255], [255, 0, 0, 255]], 2)
    const indexed = toIndexed(img, ['#00ff00', '#ff0000'])
    const bytes = encodeIndexedTga(indexed)
    expect(bytes[1]).toBe(1) // has a color map
    expect(bytes[7]).toBe(32) // translucent entry → 32-bit map
    expect(bytes[17]).toBe(0) // bottom-left origin, no alpha bits on the 8-bit indices
    // Rows are stored bottom-up.
    expect([...bytes.subarray(bytes.length - 4)]).toEqual([...indexed.indices.subarray(2), ...indexed.indices.subarray(0, 2)])
    expect(decodeTga(bytes)).toEqual(img)
  })

  it('uses a 24-bit color map when every entry is opaque', () => {
    const img = rgba([[255, 0, 0, 255], [0, 255, 0, 255]], 2)
    const bytes = encodeIndexedTga(toIndexed(img))
    expect(bytes[7]).toBe(24)
    expect(decodeTga(bytes)).toEqual(img)
  })
})
