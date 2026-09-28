// RGBA → indexed conversion for indexed export (PNG, TGA, BMP).

import { rgbToOklab } from '@/color/oklab'
import { hexToRgb8 } from '@/palette/palette'
import type { IndexedImage, RgbaImage } from './png'

export class IndexedExportError extends Error {}

type Entry = [number, number, number, number]

const TRANSPARENT = -1

/**
 * Packed RGBA key of pixel i; every fully transparent pixel maps to TRANSPARENT. Without `alpha`
 * (formats whose palette has no alpha) every other pixel counts as opaque.
 */
function keyAt(data: Uint8Array, i: number, alpha = true): number {
  const o = i * 4
  if (data[o + 3] === 0) return TRANSPARENT
  return ((data[o]! << 24) | (data[o + 1]! << 16) | (data[o + 2]! << 8) | (alpha ? data[o + 3]! : 255)) >>> 0
}

const unpack = (k: number): Entry => [k >>> 24, (k >>> 16) & 255, (k >>> 8) & 255, k & 255]
const lightness = (k: number): number => rgbToOklab([(k >>> 24) / 255, ((k >>> 16) & 255) / 255, ((k >>> 8) & 255) / 255])[0]

/**
 * Converts straight RGBA8 to indices + palette. All fully transparent pixels share one entry at
 * index 0 (like a PSX CLUT). With `palette`, its colors keep their order (unused ones too) and every
 * opaque pixel must match one of them exactly; otherwise the image's own colors are used, dark → light.
 * With `alpha: false` (the file's palette can't store alpha) semi-transparent pixels are indexed as
 * opaque, so they don't take extra entries.
 */
export function toIndexed(image: RgbaImage, palette?: string[], { alpha = true } = {}): IndexedImage {
  const { width, height, data } = image
  const pixels = width * height

  const unique = new Set<number>()
  let hasTransparent = false
  for (let i = 0; i < pixels; i++) {
    const k = keyAt(data, i, alpha)
    if (k === TRANSPARENT) hasTransparent = true
    else unique.add(k)
  }

  const entries: Entry[] = hasTransparent ? [[0, 0, 0, 0]] : []
  const indexOf = new Map<number, number>()
  const add = (k: number, entry: Entry = unpack(k)): void => {
    if (!indexOf.has(k)) indexOf.set(k, entries.length)
    entries.push(entry)
  }

  if (palette) {
    for (const hex of palette) {
      const [r, g, b] = hexToRgb8(hex)
      add(((r << 24) | (g << 16) | (b << 8) | 255) >>> 0, [r, g, b, 255])
    }
    const missing = [...unique].filter((k) => !indexOf.has(k) && (k & 255) === 255).length
    if (missing) {
      throw new IndexedExportError(
        `${missing} color${missing > 1 ? 's are' : ' is'} not in the palette. ` +
          'Turn on the output palette lock (or end the stack with a Quantize) to snap the image to it.'
      )
    }
    // Semi-transparent colors get their own entries after the palette.
    for (const k of unique) if (!indexOf.has(k)) add(k)
  } else {
    const sorted = [...unique].sort((a, b) => lightness(a) - lightness(b) || (a & 255) - (b & 255))
    for (const k of sorted) add(k)
  }

  if (entries.length > 256) {
    throw new IndexedExportError(
      `The image has ${entries.length} colors; indexed images allow 256. ` +
        'Add a Quantize or Dither stage, or turn on the output palette lock.'
    )
  }
  if (entries.length === 0) entries.push([0, 0, 0, 0])

  const indices = new Uint8Array(pixels)
  for (let i = 0; i < pixels; i++) {
    const k = keyAt(data, i, alpha)
    indices[i] = k === TRANSPARENT ? 0 : indexOf.get(k)!
  }
  return { width, height, indices, palette: entries }
}

export function hasTransparency(image: RgbaImage): boolean {
  for (let i = 3; i < image.data.length; i += 4) if (image.data[i] === 0) return true
  return false
}

/** True when some pixel is neither fully transparent nor fully opaque. */
export function hasTranslucency(image: RgbaImage): boolean {
  for (let i = 3; i < image.data.length; i += 4) if (image.data[i] !== 0 && image.data[i] !== 255) return true
  return false
}

/**
 * Distinct colors in the image (fully transparent pixels count as one), counting stops at `limit`.
 * Without `alpha`, colors that differ only in (non-zero) alpha count once.
 */
export function countColors(image: RgbaImage, limit = 257, alpha = true): number {
  const seen = new Set<number>()
  for (let i = 0; i < image.width * image.height && seen.size < limit; i++) seen.add(keyAt(image.data, i, alpha))
  return seen.size
}
