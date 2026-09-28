// TGA decoder. Browsers can't decode TGA, but it's everywhere in game texture pipelines.
// Supports color-mapped (1/9), truecolor (2/10) and grayscale (3/11), raw or RLE,
// 8/15/16/24/32-bit pixels, and both origins.

import type { RgbaImage } from './png'

export function decodeTga(bytes: Uint8Array): RgbaImage {
  if (bytes.length < 18) throw new Error('TGA: file too short')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const idLength = bytes[0]!
  const colorMapType = bytes[1]!
  const imageType = bytes[2]!
  const cmapFirst = view.getUint16(3, true)
  const cmapLength = view.getUint16(5, true)
  const cmapDepth = bytes[7]!
  const width = view.getUint16(12, true)
  const height = view.getUint16(14, true)
  const depth = bytes[16]!
  const descriptor = bytes[17]!
  const alphaBits = descriptor & 0x0f
  const topToBottom = (descriptor & 0x20) !== 0
  const rightToLeft = (descriptor & 0x10) !== 0

  const baseType = imageType & ~8
  const rle = (imageType & 8) !== 0
  if (![1, 2, 3].includes(baseType)) throw new Error(`TGA: unsupported image type ${imageType}`)
  if (width === 0 || height === 0) throw new Error('TGA: empty image')

  let offset = 18 + idLength

  // Color map entries → RGBA
  let palette: Uint8Array | null = null
  if (colorMapType === 1) {
    const entryBytes = Math.ceil(cmapDepth / 8)
    palette = new Uint8Array((cmapFirst + cmapLength) * 4)
    for (let i = 0; i < cmapLength; i++) {
      readPixel(bytes, offset + i * entryBytes, cmapDepth, palette, (cmapFirst + i) * 4, alphaBits)
    }
    offset += cmapLength * entryBytes
  }
  if (baseType === 1 && !palette) throw new Error('TGA: color-mapped image without a color map')

  const pixelBytes = Math.ceil(depth / 8)
  const count = width * height
  // Decode into file order first, then flip into top-left origin.
  const raw = new Uint8Array(count * 4)

  const writePixel = (src: number, dst: number): void => {
    if (baseType === 1) {
      const index = pixelBytes === 1 ? bytes[src]! : view.getUint16(src, true)
      raw.set(palette!.subarray(index * 4, index * 4 + 4), dst * 4)
    } else if (baseType === 3) {
      const g = bytes[src]!
      raw[dst * 4] = raw[dst * 4 + 1] = raw[dst * 4 + 2] = g
      raw[dst * 4 + 3] = pixelBytes === 2 ? bytes[src + 1]! : 255
    } else {
      readPixel(bytes, src, depth, raw, dst * 4, alphaBits)
    }
  }

  if (!rle) {
    if (offset + count * pixelBytes > bytes.length) throw new Error('TGA: truncated pixel data')
    for (let i = 0; i < count; i++) writePixel(offset + i * pixelBytes, i)
  } else {
    let i = 0
    while (i < count) {
      if (offset >= bytes.length) throw new Error('TGA: truncated RLE data')
      const header = bytes[offset++]!
      const n = (header & 0x7f) + 1
      if (header & 0x80) {
        for (let k = 0; k < n && i < count; k++) writePixel(offset, i++)
        offset += pixelBytes
      } else {
        for (let k = 0; k < n && i < count; k++) {
          writePixel(offset, i++)
          offset += pixelBytes
        }
      }
    }
  }

  // Many writers emit 32-bit TGAs with an all-zero alpha channel that isn't meant as alpha.
  if (baseType === 2 && depth === 32) {
    let anyAlpha = false
    for (let i = 3; i < raw.length; i += 4) if (raw[i] !== 0) { anyAlpha = true; break }
    if (!anyAlpha) for (let i = 3; i < raw.length; i += 4) raw[i] = 255
  }

  const data = new Uint8Array(count * 4)
  for (let y = 0; y < height; y++) {
    const srcY = topToBottom ? y : height - 1 - y
    for (let x = 0; x < width; x++) {
      const srcX = rightToLeft ? width - 1 - x : x
      const s = (srcY * width + srcX) * 4
      data.set(raw.subarray(s, s + 4), (y * width + x) * 4)
    }
  }
  return { width, height, data }
}

/** Reads one BGR(A) / 15-16-bit ARGB1555 / 8-bit gray pixel into RGBA at out[o]. */
function readPixel(bytes: Uint8Array, i: number, depth: number, out: Uint8Array, o: number, alphaBits: number): void {
  if (depth === 15 || depth === 16) {
    const v = bytes[i]! | (bytes[i + 1]! << 8)
    const expand = (c: number): number => (c << 3) | (c >> 2)
    out[o] = expand((v >> 10) & 31)
    out[o + 1] = expand((v >> 5) & 31)
    out[o + 2] = expand(v & 31)
    out[o + 3] = depth === 16 && alphaBits > 0 ? (v & 0x8000 ? 255 : 0) : 255
  } else if (depth === 24 || depth === 32) {
    out[o] = bytes[i + 2]!
    out[o + 1] = bytes[i + 1]!
    out[o + 2] = bytes[i]!
    out[o + 3] = depth === 32 ? bytes[i + 3]! : 255
  } else if (depth === 8) {
    out[o] = out[o + 1] = out[o + 2] = bytes[i]!
    out[o + 3] = 255
  } else {
    throw new Error(`TGA: unsupported pixel depth ${depth}`)
  }
}
