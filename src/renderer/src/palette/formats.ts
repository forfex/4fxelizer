// Palette file import/export. Import: .hex, .gpl, .pal (JASC text or RIFF binary), .act, .ase.
// Export: .hex, .gpl, .act, .pal (JASC).

import { oklabToRgb } from '@/color/oklab'
import { MAX_PALETTE, normalizeHex, rgb8ToHex, hexToRgb8 } from './palette'

export interface ParsedPalette {
  name?: string
  colors: string[]
}

export type PaletteExportFormat = 'hex' | 'gpl' | 'act' | 'pal'

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

function parseHex(src: string): ParsedPalette {
  const colors = src
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith(';') && !l.startsWith('//'))
    .map((l) => normalizeHex(l.replace(/^0x/i, '').slice(0, 7)))
    .filter((c): c is string => c !== null)
  return { colors }
}

function parseGpl(src: string): ParsedPalette {
  const lines = src.split(/\r?\n/)
  if (!lines[0]?.startsWith('GIMP Palette')) throw new Error('Not a GIMP palette (missing "GIMP Palette" header).')
  let name: string | undefined
  const colors: string[] = []
  for (const line of lines.slice(1)) {
    const l = line.trim()
    if (!l || l.startsWith('#')) continue
    const nameMatch = /^Name:\s*(.*)$/.exec(l)
    if (nameMatch) {
      name = nameMatch[1]
      continue
    }
    if (/^Columns:/.test(l)) continue
    const m = /^(\d+)\s+(\d+)\s+(\d+)/.exec(l)
    if (m) colors.push(rgb8ToHex(+m[1]!, +m[2]!, +m[3]!))
  }
  return { name, colors }
}

function parseJascPal(src: string): ParsedPalette {
  const lines = src.split(/\r?\n/).map((l) => l.trim())
  if (lines[0] !== 'JASC-PAL') throw new Error('Unrecognized .pal file.')
  const count = parseInt(lines[2] ?? '0', 10)
  const colors: string[] = []
  for (const l of lines.slice(3, 3 + count)) {
    const m = /^(\d+)\s+(\d+)\s+(\d+)/.exec(l)
    if (m) colors.push(rgb8ToHex(+m[1]!, +m[2]!, +m[3]!))
  }
  return { colors }
}

/** Microsoft RIFF palette: "RIFF" … "PAL " "data" chunk with LOGPALETTE (version, count, RGBx entries). */
function parseRiffPal(bytes: Uint8Array): ParsedPalette {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(...bytes.subarray(offset, offset + 4))
    const size = view.getUint32(offset + 4, true)
    if (id === 'data') {
      const count = view.getUint16(offset + 10, true)
      const colors: string[] = []
      for (let i = 0; i < count; i++) {
        const p = offset + 12 + i * 4
        colors.push(rgb8ToHex(bytes[p]!, bytes[p + 1]!, bytes[p + 2]!))
      }
      return { colors }
    }
    offset += 8 + size + (size & 1)
  }
  throw new Error('RIFF palette has no data chunk.')
}

/** Adobe Color Table: 256 RGB triplets, optionally followed by a count and a transparent index. */
function parseAct(bytes: Uint8Array): ParsedPalette {
  if (bytes.length < 768) throw new Error('.act file is too short.')
  const count = bytes.length >= 772 ? Math.min((bytes[768]! << 8) | bytes[769]!, 256) || 256 : 256
  const colors: string[] = []
  for (let i = 0; i < count; i++) colors.push(rgb8ToHex(bytes[i * 3]!, bytes[i * 3 + 1]!, bytes[i * 3 + 2]!))
  return { colors }
}

/** Adobe Swatch Exchange: color entries in RGB, Gray, LAB or CMYK (CMYK is converted naively). */
function parseAse(bytes: Uint8Array): ParsedPalette {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'ASEF') throw new Error('Not an ASE file.')
  const blocks = view.getUint32(8)
  let offset = 12
  const colors: string[] = []
  for (let b = 0; b < blocks && offset + 6 <= bytes.length; b++) {
    const type = view.getUint16(offset)
    const length = view.getUint32(offset + 2)
    const start = offset + 6
    if (type === 0x0001) {
      const nameLength = view.getUint16(start)
      let p = start + 2 + nameLength * 2
      const model = String.fromCharCode(...bytes.subarray(p, p + 4)).trim()
      p += 4
      const f = (i: number): number => view.getFloat32(p + i * 4)
      let rgb: [number, number, number] | null = null
      if (model === 'RGB') rgb = [f(0), f(1), f(2)]
      else if (model === 'Gray') rgb = [f(0), f(0), f(0)]
      else if (model === 'CMYK') rgb = [(1 - f(0)) * (1 - f(3)), (1 - f(1)) * (1 - f(3)), (1 - f(2)) * (1 - f(3))]
      else if (model === 'LAB') {
        // CIELAB (L 0..1 scaled to 0..100, a/b in -128..127) approximated through OKLab ranges.
        rgb = oklabToRgb([f(0), f(1) / 400, f(2) / 400])
      }
      if (rgb) colors.push(rgb8ToHex(rgb[0] * 255, rgb[1] * 255, rgb[2] * 255))
    }
    offset = start + length
  }
  return { colors }
}

export function parsePaletteFile(name: string, bytes: Uint8Array): ParsedPalette {
  const ext = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase()
  let parsed: ParsedPalette
  switch (ext) {
    case 'hex':
    case 'txt':
      parsed = parseHex(text(bytes))
      break
    case 'gpl':
      parsed = parseGpl(text(bytes))
      break
    case 'pal':
      parsed = String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' ? parseRiffPal(bytes) : parseJascPal(text(bytes))
      break
    case 'act':
      parsed = parseAct(bytes)
      break
    case 'ase':
      parsed = parseAse(bytes)
      break
    default:
      throw new Error(`Unsupported palette format ".${ext ?? '?'}". Use .hex, .gpl, .pal, .act or .ase.`)
  }
  if (!parsed.colors.length) throw new Error(`No colors found in ${name}.`)
  return { name: parsed.name, colors: parsed.colors.slice(0, MAX_PALETTE) }
}

export function exportPalette(name: string, colors: string[], format: PaletteExportFormat): Uint8Array {
  const enc = (s: string): Uint8Array => new TextEncoder().encode(s)
  switch (format) {
    case 'hex':
      return enc(colors.map((c) => c.slice(1)).join('\n') + '\n')
    case 'gpl':
      return enc(
        `GIMP Palette\nName: ${name}\nColumns: 8\n#\n` +
          colors.map((c) => {
            const [r, g, b] = hexToRgb8(c)
            return `${String(r).padStart(3)} ${String(g).padStart(3)} ${String(b).padStart(3)}\t${c.slice(1)}`
          }).join('\n') +
          '\n'
      )
    case 'pal':
      return enc(
        `JASC-PAL\r\n0100\r\n${colors.length}\r\n` + colors.map((c) => hexToRgb8(c).join(' ')).join('\r\n') + '\r\n'
      )
    case 'act': {
      const out = new Uint8Array(772)
      colors.slice(0, 256).forEach((c, i) => out.set(hexToRgb8(c), i * 3))
      out[768] = (colors.length >> 8) & 0xff
      out[769] = colors.length & 0xff
      out[770] = 0xff // no transparent index
      out[771] = 0xff
      return out
    }
  }
}
