import { describe, expect, it } from 'vitest'
import { encodeBmp, encodeIndexedBmp } from './bmp'
import { toIndexed } from './indexed'
import type { RgbaImage } from './png'

/** Test-side BMP reader for the variants the encoder writes (bottom-up, BI_RGB / BI_BITFIELDS). */
function readBmp(bytes: Uint8Array): RgbaImage & { bpp: number; headerSize: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  expect(String.fromCharCode(bytes[0]!, bytes[1]!)).toBe('BM')
  expect(view.getUint32(2, true)).toBe(bytes.length)
  const offset = view.getUint32(10, true)
  const headerSize = view.getUint32(14, true)
  const width = view.getInt32(18, true)
  const height = view.getInt32(22, true)
  const bpp = view.getUint16(28, true)
  const colors = view.getUint32(46, true)
  const stride = Math.ceil((width * bpp) / 32) * 4
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const row = offset + (height - 1 - y) * stride
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      if (bpp >= 24) {
        const s = row + x * (bpp / 8)
        data.set([bytes[s + 2]!, bytes[s + 1]!, bytes[s]!, bpp === 32 ? bytes[s + 3]! : 255], o)
      } else {
        const perByte = 8 / bpp
        const index = (bytes[row + Math.floor(x / perByte)]! >> (8 - bpp * ((x % perByte) + 1))) & ((1 << bpp) - 1)
        expect(index).toBeLessThan(colors)
        const c = 14 + headerSize + index * 4
        data.set([bytes[c + 2]!, bytes[c + 1]!, bytes[c]!, 255], o)
      }
    }
  }
  return { width, height, data, bpp, headerSize }
}

const rgba = (pixels: number[][], width: number): RgbaImage => ({
  width,
  height: pixels.length / width,
  data: new Uint8Array(pixels.flat())
})

describe('encodeBmp', () => {
  it('writes opaque images as 24-bit with padded rows', () => {
    const img = rgba([[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [10, 20, 30, 255], [1, 2, 3, 255], [200, 100, 50, 255]], 3)
    const bytes = encodeBmp(img)
    const back = readBmp(bytes)
    expect(back.bpp).toBe(24)
    expect(bytes.length).toBe(54 + 12 * 2) // 3 px × 3 bytes = 9, padded to 12
    expect(back.data).toEqual(img.data)
  })

  it('keeps straight alpha as 32-bit with an alpha mask', () => {
    const img = rgba([[255, 0, 0, 128], [0, 0, 0, 0], [9, 8, 7, 255], [100, 150, 200, 1]], 2)
    const bytes = encodeBmp(img)
    const back = readBmp(bytes)
    expect(back.bpp).toBe(32)
    expect(back.headerSize).toBe(108)
    expect(new DataView(bytes.buffer).getUint32(66, true)).toBe(0xff000000)
    expect(back.data).toEqual(img.data)
  })
})

describe('encodeIndexedBmp', () => {
  it('picks 1/4/8 bits per pixel and keeps palette order', () => {
    for (const [count, bpp] of [[2, 1], [3, 4], [16, 4], [17, 8], [256, 8]] as const) {
      const pixels = Array.from({ length: count }, (_, i) => [i, 255 - i, (i * 7) & 255, 255])
      const img = rgba(pixels, count)
      const indexed = toIndexed(img)
      const back = readBmp(encodeIndexedBmp(indexed))
      expect(back.bpp).toBe(bpp)
      expect(back.data).toEqual(img.data)
    }
  })

  it('stores transparent pixels at index 0 (BMP palettes have no alpha)', () => {
    const img = rgba([[0, 0, 0, 0], [255, 0, 0, 255], [0, 255, 0, 255]], 3)
    const bytes = encodeIndexedBmp(toIndexed(img, ['#ff0000', '#00ff00']))
    expect(readBmp(bytes).data).toEqual(new Uint8Array([0, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255]))
  })
})
