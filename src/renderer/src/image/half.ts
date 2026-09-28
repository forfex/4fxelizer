// Readback helpers for rgba16float textures (the working format of the pass framework).

export function halfToFloat(h: number): number {
  const sign = h & 0x8000 ? -1 : 1
  const exponent = (h >> 10) & 0x1f
  const mantissa = h & 0x3ff
  if (exponent === 0) return sign * 2 ** -14 * (mantissa / 1024)
  if (exponent === 31) return mantissa ? NaN : sign * Infinity
  return sign * 2 ** (exponent - 15) * (1 + mantissa / 1024)
}

let unormLut: Uint8Array | null = null

/** Half-float bit pattern → clamped, rounded 8-bit unorm, via a 64K lookup table. */
export function halfToUnorm8Lut(): Uint8Array {
  if (!unormLut) {
    unormLut = new Uint8Array(65536)
    for (let h = 0; h < 65536; h++) {
      const v = halfToFloat(h)
      unormLut[h] = Number.isNaN(v) ? 0 : Math.round(Math.min(Math.max(v, 0), 1) * 255)
    }
  }
  return unormLut
}

/** Converts padded rgba16float rows (as copied by copyTextureToBuffer) into tight RGBA8. */
export function rgba16fRowsToRgba8(
  src: Uint16Array,
  width: number,
  height: number,
  bytesPerRow: number
): Uint8Array<ArrayBuffer> {
  const lut = halfToUnorm8Lut()
  const out = new Uint8Array(width * height * 4)
  const halvesPerRow = bytesPerRow / 2
  for (let y = 0; y < height; y++) {
    const s = y * halvesPerRow
    const d = y * width * 4
    for (let i = 0; i < width * 4; i++) out[d + i] = lut[src[s + i]!]!
  }
  return out
}
