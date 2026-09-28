// Minimal PNG encoder (8-bit RGBA, truecolor).
// Written by hand instead of canvas.toBlob because the canvas path premultiplies alpha,
// which changes the color of semi-transparent texels. Indexed (PLTE/tRNS) export builds on this.

export interface RgbaImage {
  width: number
  height: number
  /** Straight (non-premultiplied) RGBA, 4 bytes per pixel, rows top to bottom. */
  data: Uint8Array<ArrayBuffer>
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array, crc = 0xffffffff): number {
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8)
  return crc
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, (crc32(out.subarray(4, 8 + data.length)) ^ 0xffffffff) >>> 0)
  return out
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** Applies the per-row filter that minimizes the sum of absolute differences (standard heuristic). */
export function filterScanlines(data: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
  const stride = width * bpp
  const out = new Uint8Array(height * (stride + 1))
  const candidates = Array.from({ length: 5 }, () => new Uint8Array(stride))
  const zero = new Uint8Array(stride)

  for (let y = 0; y < height; y++) {
    const row = data.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? data.subarray((y - 1) * stride, y * stride) : zero
    let best = 0
    let bestScore = Infinity
    for (let f = 0; f < 5; f++) {
      const line = candidates[f]!
      let score = 0
      for (let i = 0; i < stride; i++) {
        const x = row[i]!
        const a = i >= bpp ? row[i - bpp]! : 0
        const b = prev[i]!
        const c = i >= bpp ? prev[i - bpp]! : 0
        const predicted = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c)
        const v = (x - predicted) & 0xff
        line[i] = v
        score += v < 128 ? v : 256 - v
      }
      if (score < bestScore) {
        bestScore = score
        best = f
      }
    }
    const offset = y * (stride + 1)
    out[offset] = best
    out.set(candidates[best]!, offset + 1)
  }
  return out
}

async function zlibDeflate(data: Uint8Array): Promise<Uint8Array> {
  // 'deflate' = zlib wrapper (RFC 1950), which is exactly what IDAT expects.
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function ihdr(width: number, height: number, bitDepth: number, colorType: number): Uint8Array {
  const data = new Uint8Array(13)
  const view = new DataView(data.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  data[8] = bitDepth
  data[9] = colorType
  // compression, filter, interlace = 0
  return chunk('IHDR', data)
}

function assemble(chunks: Uint8Array[]): Uint8Array {
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const parts = [signature, ...chunks, chunk('IEND', new Uint8Array(0))]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

export async function encodePng(image: RgbaImage): Promise<Uint8Array> {
  const { width, height, data } = image
  if (data.length !== width * height * 4) throw new Error('encodePng: data size does not match dimensions')
  const idat = await zlibDeflate(filterScanlines(data, width, height, 4))
  return assemble([ihdr(width, height, 8, 6), chunk('IDAT', idat)])
}

export interface IndexedImage {
  width: number
  height: number
  /** One palette index per pixel, rows top to bottom. */
  indices: Uint8Array
  /** Straight RGBA palette entries (1–256). */
  palette: [number, number, number, number][]
}

/** Smallest PNG bit depth that can address `count` palette entries. */
export function indexedBitDepth(count: number): 1 | 2 | 4 | 8 {
  return count <= 2 ? 1 : count <= 4 ? 2 : count <= 16 ? 4 : 8
}

/** Indexed-color PNG (color type 3) at the smallest bit depth; tRNS only when needed. */
export async function encodeIndexedPng(image: IndexedImage): Promise<Uint8Array> {
  const { width, height, indices, palette } = image
  if (indices.length !== width * height) throw new Error('encodeIndexedPng: data size does not match dimensions')
  if (palette.length === 0 || palette.length > 256) throw new Error('encodeIndexedPng: palette must have 1–256 entries')
  const depth = indexedBitDepth(palette.length)
  const perByte = 8 / depth
  const stride = Math.ceil(width / perByte)

  // Filter type 0 (None) on every row, as the PNG spec recommends for palette images.
  const raw = new Uint8Array(height * (stride + 1))
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1) + 1
    for (let x = 0; x < width; x++) {
      const shift = 8 - depth * ((x % perByte) + 1)
      raw[row + Math.floor(x / perByte)]! |= indices[y * width + x]! << shift
    }
  }

  const plte = new Uint8Array(palette.length * 3)
  palette.forEach(([r, g, b], i) => plte.set([r, g, b], i * 3))
  const chunks = [ihdr(width, height, depth, 3), chunk('PLTE', plte)]
  const lastTranslucent = palette.findLastIndex(([, , , a]) => a < 255)
  if (lastTranslucent >= 0) {
    chunks.push(chunk('tRNS', new Uint8Array(palette.slice(0, lastTranslucent + 1).map(([, , , a]) => a))))
  }
  chunks.push(chunk('IDAT', await zlibDeflate(raw)))
  return assemble(chunks)
}
