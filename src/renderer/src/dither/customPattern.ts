// Custom dither patterns: any small grayscale image used as an ordered threshold map. The image is
// stored in the stage params as a compact string ("WxH:" + base64 gray bytes), so presets carry it.
// Its brightness only sets the order in which pixels switch; thresholds are ranks spread evenly over
// 0–1, so any image dithers with even steps (pixels of the same gray switch together).

import type { RgbaImage } from '@/image/png'

/** Largest pattern side in pixels. */
export const MAX_PATTERN_SIDE = 128

export interface PatternImage {
  width: number
  height: number
  /** Gray value per pixel, row by row. */
  gray: Uint8Array
}

export function encodePattern({ width, height, gray }: PatternImage): string {
  let binary = ''
  for (const v of gray) binary += String.fromCharCode(v)
  return `${width}x${height}:${btoa(binary)}`
}

/** The pattern in a params string, or null when it's empty or malformed. */
export function decodePattern(encoded: string): PatternImage | null {
  const m = /^(\d+)x(\d+):([A-Za-z0-9+/=]*)$/.exec(encoded)
  if (!m) return null
  const width = Number(m[1])
  const height = Number(m[2])
  if (!width || !height || width > MAX_PATTERN_SIDE || height > MAX_PATTERN_SIDE) return null
  let binary: string
  try {
    binary = atob(m[3]!)
  } catch {
    return null
  }
  if (binary.length !== width * height) return null
  return { width, height, gray: Uint8Array.from(binary, (c) => c.charCodeAt(0)) }
}

/** Grayscale pattern from an RGBA image (Rec. 709 luma of the stored values; alpha ignored). */
export function patternFromRgba(image: RgbaImage): PatternImage {
  if (image.width > MAX_PATTERN_SIDE || image.height > MAX_PATTERN_SIDE) {
    throw new Error(`Pattern images can be up to ${MAX_PATTERN_SIDE}×${MAX_PATTERN_SIDE} pixels; this one is ${image.width}×${image.height}.`)
  }
  const gray = new Uint8Array(image.width * image.height)
  for (let i = 0; i < gray.length; i++) {
    const d = image.data
    gray[i] = Math.round(0.2126 * d[i * 4]! + 0.7152 * d[i * 4 + 1]! + 0.0722 * d[i * 4 + 2]!)
  }
  return { width: image.width, height: image.height, gray }
}

/**
 * Thresholds (0–1, mean 0.5) from gray values by rank: darker pixels get lower thresholds, so they
 * turn dark first. Equal grays share their average rank.
 */
export function patternThresholds(gray: Uint8Array): Float32Array {
  const n = gray.length
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => gray[a]! - gray[b]!)
  const out = new Float32Array(n)
  for (let start = 0; start < n; ) {
    let end = start
    while (end < n && gray[order[end]!] === gray[order[start]!]) end++
    const rank = (start + end - 1) / 2
    for (let k = start; k < end; k++) out[order[k]!] = (rank + 0.5) / n
    start = end
  }
  return out
}
