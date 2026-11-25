// How an exported texture fits PSX limits: texture page size, CLUT depth, 15-bit color and the
// PSX transparency rules (texel 0x0000, pure black, is transparent; no per-texel alpha).

import type { RgbaImage } from './png'

/** Largest PSX texture side (one texture page). */
export const PSX_MAX_SIDE = 256

/** 8-bit channel values that are exact 5-bit values (what snapping to 15-bit color returns). */
const EXACT_5BIT = new Set(Array.from({ length: 32 }, (_, v) => Math.round((v / 31) * 255)))

/** Pixel facts the PSX check needs, from one pass over the image. */
export interface PsxStats {
  /** Distinct opaque colors that aren't exact 15-bit colors (stops counting at 257). */
  off15bit: number
  /** Some pixels are opaque pure black. */
  opaqueBlack: boolean
}

export function psxStats(image: RgbaImage): PsxStats {
  const { data } = image
  const off = new Set<number>()
  let opaqueBlack = false
  for (let o = 0; o < image.width * image.height * 4; o += 4) {
    if (data[o + 3] === 0) continue
    const r = data[o]!
    const g = data[o + 1]!
    const b = data[o + 2]!
    if (r === 0 && g === 0 && b === 0) opaqueBlack = true
    if (off.size < 257 && !(EXACT_5BIT.has(r) && EXACT_5BIT.has(g) && EXACT_5BIT.has(b))) off.add((r << 16) | (g << 8) | b)
  }
  return { off15bit: off.size, opaqueBlack }
}

/** Bytes of the PSX's video memory (1024×512 at 16 bits), shared by the screen and every texture. */
export const PSX_VRAM_BYTES = 1024 * 512 * 2

export interface PsxMemory {
  /** Bits per texel: 4 or 8 with a CLUT, 16 for direct color. */
  depth: 4 | 8 | 16
  /** Bytes of the texels. */
  texels: number
  /** Bytes of the CLUT (16 or 256 entries of 16 bits; none for direct color). */
  clut: number
}

/** What a texture of that size and color count takes in PSX video memory. */
export function psxMemory(width: number, height: number, colors: number): PsxMemory {
  const depth = colors <= 16 ? 4 : colors <= 256 ? 8 : 16
  return { depth, texels: Math.ceil((width * height * depth) / 8), clut: depth === 4 ? 32 : depth === 8 ? 512 : 0 }
}

function bytesText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  return `${kb >= 100 ? Math.round(kb) : Math.round(kb * 10) / 10} KB`
}

export type PsxCheckState = 'ok' | 'warn' | 'fail'

export interface PsxCheck {
  state: PsxCheckState
  text: string
}

export interface PsxInput extends PsxStats {
  width: number
  height: number
  /** Entries an indexed file would need (transparent pixels share one), or distinct colors. */
  colors: number
  transparent: boolean
  translucent: boolean
}

const isPowerOfTwo = (n: number): boolean => n > 0 && (n & (n - 1)) === 0

/** One line per PSX limit, in the order an artist would fix them. */
export function psxChecks(o: PsxInput): PsxCheck[] {
  const checks: PsxCheck[] = []
  const size = `${o.width}×${o.height}`
  if (o.width > PSX_MAX_SIDE || o.height > PSX_MAX_SIDE) {
    checks.push({ state: 'fail', text: `${size} is larger than a texture page (256×256). Downscale to 256 or less.` })
  } else if (!isPowerOfTwo(o.width) || !isPowerOfTwo(o.height)) {
    checks.push({ state: 'warn', text: `${size} isn't a power of two, so the texture can't repeat. Turn on "Power of two" in Downscale.` })
  } else {
    checks.push({ state: 'ok', text: `${size} fits a texture page.` })
  }

  if (o.colors <= 16) checks.push({ state: 'ok', text: `${o.colors} colors: fits a 4-bit CLUT (16 entries).` })
  else if (o.colors <= 256) checks.push({ state: 'ok', text: `${o.colors} colors: fits an 8-bit CLUT (256 entries).` })
  else checks.push({ state: 'warn', text: 'More than 256 colors: only 15-bit direct color, which takes 2× the VRAM of 8-bit.' })

  if (o.off15bit === 0) {
    checks.push({ state: 'ok', text: 'All colors are 15-bit.' })
  } else {
    const n = o.off15bit > 256 ? 'More than 256' : String(o.off15bit)
    checks.push({
      state: 'warn',
      text: `${n} ${o.off15bit > 1 ? "colors aren't" : "color isn't"} 15-bit and will shift slightly. Turn on "15-bit colors" in the palette generator, use the palette's 15-bit button, or quantize to 32 levels.`
    })
  }

  const memory = psxMemory(o.width, o.height, o.colors)
  const share = ((memory.texels + memory.clut) / PSX_VRAM_BYTES) * 100
  checks.push({
    state: 'ok',
    text:
      `Video memory: ${bytesText(memory.texels)} at ${memory.depth}-bit` +
      (memory.clut ? ` + ${bytesText(memory.clut)} CLUT` : '') +
      `, ${share < 0.1 ? 'under 0.1' : share >= 10 ? Math.round(share) : Math.round(share * 10) / 10}% of the PSX's 1 MB.`
  })

  if (o.translucent) {
    checks.push({ state: 'warn', text: 'Semi-transparent pixels: PSX texels are opaque or fully transparent (semi-transparency is set per polygon).' })
  }
  if (o.opaqueBlack) {
    checks.push({ state: 'warn', text: 'Opaque pure black is transparent on the PSX. Use #080808 instead, or set the STP bit when converting.' })
  }
  return checks
}
