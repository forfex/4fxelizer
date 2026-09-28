// BMP encoder. Opaque images are written as plain 24-bit / indexed BMPs that every tool reads;
// images with alpha use a 32-bit BITMAPV4HEADER with an alpha mask. BMP color tables have no
// alpha, so indexed BMPs lose transparency (transparent pixels keep their index, 0).

import type { IndexedImage, RgbaImage } from './png'

const FILE_HEADER = 14
const INFO_HEADER = 40
const V4_HEADER = 108
const PIXELS_PER_METER = 2835 // 72 DPI

function headers(fileSize: number, dataOffset: number, info: { size: number; width: number; height: number; bpp: number; compression: number; imageSize: number; colors: number }): Uint8Array {
  const out = new Uint8Array(FILE_HEADER + info.size)
  const view = new DataView(out.buffer)
  out[0] = 0x42 // 'B'
  out[1] = 0x4d // 'M'
  view.setUint32(2, fileSize, true)
  view.setUint32(10, dataOffset, true)
  view.setUint32(14, info.size, true)
  view.setInt32(18, info.width, true)
  view.setInt32(22, info.height, true) // positive: rows bottom to top
  view.setUint16(26, 1, true)
  view.setUint16(28, info.bpp, true)
  view.setUint32(30, info.compression, true)
  view.setUint32(34, info.imageSize, true)
  view.setInt32(38, PIXELS_PER_METER, true)
  view.setInt32(42, PIXELS_PER_METER, true)
  view.setUint32(46, info.colors, true)
  return out
}

/** 24-bit BMP when every pixel is opaque, else 32-bit BGRA with an alpha mask (straight alpha). */
export function encodeBmp(image: RgbaImage): Uint8Array {
  const { width, height, data } = image
  let opaque = true
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) { opaque = false; break }
  const bpp = opaque ? 3 : 4
  const stride = Math.ceil((width * bpp) / 4) * 4
  const infoSize = opaque ? INFO_HEADER : V4_HEADER
  const offset = FILE_HEADER + infoSize
  const imageSize = stride * height
  const out = new Uint8Array(offset + imageSize)
  // 3 = BI_BITFIELDS: explicit channel masks, needed to mark the alpha channel.
  out.set(headers(out.length, offset, { size: infoSize, width, height, bpp: bpp * 8, compression: opaque ? 0 : 3, imageSize, colors: 0 }))
  if (!opaque) {
    const view = new DataView(out.buffer)
    view.setUint32(54, 0x00ff0000, true) // red
    view.setUint32(58, 0x0000ff00, true) // green
    view.setUint32(62, 0x000000ff, true) // blue
    view.setUint32(66, 0xff000000, true) // alpha
    view.setUint32(70, 0x73524742, true) // 'sRGB' color space
  }
  for (let y = 0; y < height; y++) {
    const row = offset + (height - 1 - y) * stride
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4
      const o = row + x * bpp
      out[o] = data[s + 2]!
      out[o + 1] = data[s + 1]!
      out[o + 2] = data[s]!
      if (!opaque) out[o + 3] = data[s + 3]!
    }
  }
  return out
}

/** Bits per pixel an indexed BMP needs for `count` palette entries (BMP has 1, 4 and 8). */
export function bmpBitDepth(count: number): 1 | 4 | 8 {
  return count <= 2 ? 1 : count <= 16 ? 4 : 8
}

/** Indexed BMP (1/4/8-bit, uncompressed). Palette alpha is dropped. */
export function encodeIndexedBmp(image: IndexedImage): Uint8Array {
  const { width, height, indices, palette } = image
  if (palette.length === 0 || palette.length > 256) throw new Error('BMP: palette must have 1–256 entries')
  const depth = bmpBitDepth(palette.length)
  const perByte = 8 / depth
  const stride = Math.ceil(Math.ceil(width / perByte) / 4) * 4
  const offset = FILE_HEADER + INFO_HEADER + palette.length * 4
  const imageSize = stride * height
  const out = new Uint8Array(offset + imageSize)
  out.set(headers(out.length, offset, { size: INFO_HEADER, width, height, bpp: depth, compression: 0, imageSize, colors: palette.length }))
  palette.forEach(([r, g, b], i) => out.set([b, g, r, 0], FILE_HEADER + INFO_HEADER + i * 4))
  for (let y = 0; y < height; y++) {
    const row = offset + (height - 1 - y) * stride
    for (let x = 0; x < width; x++) {
      const shift = 8 - depth * ((x % perByte) + 1)
      out[row + Math.floor(x / perByte)]! |= indices[y * width + x]! << shift
    }
  }
  return out
}
