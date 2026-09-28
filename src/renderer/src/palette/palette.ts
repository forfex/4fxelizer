// Palettes are project resources: any stage (Quantize, Dither, output lock) can reference one by id.

import { rgbToOklab, type Vec3 } from '@/color/oklab'

export interface PaletteColor {
  /** "#rrggbb", lowercase. */
  hex: string
  /** Locked colors survive regeneration unchanged. */
  locked?: boolean
}

export type GenerateMethod = 'median-cut' | 'kmeans'

export interface GeneratorSettings {
  method: GenerateMethod
  count: number
  /** k-means refinement iterations (ignored by median cut). */
  quality: number
  /** Scales OKLab lightness in the distance metric; > 1 keeps more light/dark steps. */
  lumaWeight: number
  /** Scales OKLab chroma (a, b); > 1 keeps more distinct hues. */
  chromaWeight: number
  /** Where the colors come from: the loaded image, or the input of a stage in the stack. */
  from: { kind: 'source' } | { kind: 'stage'; uid: string }
  /** Regenerate automatically whenever the colors it's generated from change. */
  auto: boolean
}

export interface Palette {
  id: string
  name: string
  colors: PaletteColor[]
  generator?: GeneratorSettings
}

/** Largest palette a stage can use (dithering/quantizing works with thousands of colors). */
export const MAX_PALETTE = 8192

/** Largest palette an indexed PNG (and .act file) can hold. */
export const MAX_INDEXED = 256

export const DEFAULT_GENERATOR: GeneratorSettings = {
  method: 'kmeans',
  count: 16,
  quality: 8,
  lumaWeight: 1,
  chromaWeight: 1,
  from: { kind: 'source' },
  auto: true
}

export function hexToRgb8(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', '').slice(0, 6).padEnd(6, '0'), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgb8ToHex(r: number, g: number, b: number): string {
  const c = (v: number): string => Math.round(Math.min(Math.max(v, 0), 255)).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/** Accepts "#rgb", "rgb", "#rrggbb", "rrggbb" (any case); null when invalid. */
export function normalizeHex(input: string): string | null {
  let s = input.trim().replace(/^#/, '').toLowerCase()
  if (/^[0-9a-f]{3}$/.test(s)) s = [...s].map((c) => c + c).join('')
  return /^[0-9a-f]{6}$/.test(s) ? `#${s}` : null
}

export function hexToOklab(hex: string): Vec3 {
  const [r, g, b] = hexToRgb8(hex)
  return rgbToOklab([r / 255, g / 255, b / 255])
}

/** Snaps every channel to 5 bits (PSX 15-bit color), rounding to the nearest representable value. */
export function snapHexTo15bit(hex: string): string {
  const [r, g, b] = hexToRgb8(hex).map((v) => Math.round((Math.round((v / 255) * 31) / 31) * 255)) as Vec3
  return rgb8ToHex(r, g, b)
}

export type SortKey = 'lightness' | 'hue' | 'chroma'

export function sortColors(colors: PaletteColor[], key: SortKey): PaletteColor[] {
  const value = (c: PaletteColor): number => {
    const [L, a, b] = hexToOklab(c.hex)
    if (key === 'lightness') return L
    if (key === 'chroma') return Math.hypot(a, b)
    // Hue, with near-grays grouped first by lightness.
    return Math.hypot(a, b) < 0.02 ? -10 + L : Math.atan2(b, a)
  }
  return colors
    .map((c) => ({ c, v: value(c) }))
    .sort((x, y) => x.v - y.v)
    .map((x) => x.c)
}

const signatures = new WeakMap<PaletteColor[], string>()

/**
 * Identity of a palette's colors (what a stage's cache key depends on). Cached per colors array:
 * the store replaces arrays instead of mutating them, and large palettes are thousands of colors.
 */
export function paletteSignature(p: Palette): string {
  let sig = signatures.get(p.colors)
  if (sig === undefined) {
    sig = String(p.colors.length) + ':' + hashColors(p.colors)
    signatures.set(p.colors, sig)
  }
  return sig
}

/** FNV-1a over the hex digits, as two 32-bit halves (collision-safe enough for cache keys). */
function hashColors(colors: PaletteColor[]): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (const c of colors) {
    for (let i = 1; i < 7; i++) {
      const ch = c.hex.charCodeAt(i)
      h1 = Math.imul(h1 ^ ch, 0x01000193)
      h2 = Math.imul(h2 ^ ch, 0x5bd1e995)
    }
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36)
}

/**
 * Merges freshly generated colors into an existing palette: locked colors keep their slots,
 * unlocked slots are refilled in order, extra colors are appended, surplus unlocked slots dropped.
 */
export function mergeGenerated(existing: PaletteColor[], generated: string[], count: number): PaletteColor[] {
  const queue = [...generated]
  const out: PaletteColor[] = []
  const lockedTotal = existing.filter((c) => c.locked).length
  let unlockedBudget = Math.max(count - lockedTotal, 0)
  for (const c of existing) {
    if (c.locked) out.push(c)
    else if (unlockedBudget > 0 && queue.length) {
      out.push({ hex: queue.shift()! })
      unlockedBudget--
    }
  }
  while (unlockedBudget > 0 && queue.length) {
    out.push({ hex: queue.shift()! })
    unlockedBudget--
  }
  return out
}
