// Generates the app icon: a pixel "4" of beveled tiles on a 3x3 grid, set in a dark squircle
// (the 4FXELIZER design system's app-icon.svg, Dark theme colors baked in).
// Usage: node scripts/make-icon.mjs   (writes build/icon.png, build/icon.ico, site/icon.svg, site/favicon.png,
// src/renderer/src/assets/icon.svg for the title bar)
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

const C = {
  bg: '#16121e', // fx-bg
  off: '#2d2540', // fx-panel-hi: unlit tiles
  on: '#a978ff', // fx-accent: lit tiles
  onHi: '#c6a6ff', // fx-accent-hi: their top-left highlight
  onLo: '#3f1f70' // fx-drop: their bottom-right shade
}
// The "4", row by row.
const LIT = [
  [1, 0, 1],
  [1, 1, 1],
  [0, 0, 1]
]
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))

// Layout on a 64-unit grid: a superellipse (n = 5) filling it, tiles of 13 units, 2-unit bevels.
const U = 64
const N = 5
const TILES = [10, 25.5, 41]
const TILE = 13
const BEVEL = 2

const inSquircle = (u, v) => Math.abs((u - U / 2) / (U / 2)) ** N + Math.abs((v - U / 2) / (U / 2)) ** N <= 1

/** Tile color at (u, v), or null outside the tiles. Crisp edges, like the SVG's crispEdges. */
function tileColor(u, v) {
  const col = TILES.findIndex((t) => u >= t && u < t + TILE)
  const row = TILES.findIndex((t) => v >= t && v < t + TILE)
  if (col < 0 || row < 0) return null
  if (!LIT[row][col]) return C.off
  const lu = u - TILES[col]
  const lv = v - TILES[row]
  // Later rects win in the SVG: shade (bottom, then right) over highlight.
  if (lu >= TILE - BEVEL) return C.onLo
  if (lv >= TILE - BEVEL) return C.onLo
  if (lu < BEVEL || lv < BEVEL) return C.onHi
  return C.on
}

/** RGBA pixels for a size x size icon; the squircle's edge is antialiased with 4x4 supersampling. */
function render(size) {
  const px = Buffer.alloc(size * size * 4)
  const S = 4
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inside = 0
      for (let sy = 0; sy < S; sy++)
        for (let sx = 0; sx < S; sx++) if (inSquircle(((x + (sx + 0.5) / S) / size) * U, ((y + (sy + 0.5) / S) / size) * U)) inside++
      const u = ((x + 0.5) / size) * U
      const v = ((y + 0.5) / size) * U
      const color = tileColor(u, v) ?? C.bg
      px.set([...rgb(color), Math.round((255 * inside) / (S * S))], (y * size + x) * 4)
    }
  }
  return px
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function png(size) {
  const px = render(size)
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function ico(sizes) {
  const images = sizes.map(png)
  const head = Buffer.alloc(6 + 16 * sizes.length)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(sizes.length, 4)
  let offset = head.length
  sizes.forEach((s, i) => {
    const o = 6 + i * 16
    head[o] = s >= 256 ? 0 : s
    head[o + 1] = s >= 256 ? 0 : s
    head.writeUInt16LE(1, o + 4)
    head.writeUInt16LE(32, o + 6)
    head.writeUInt32LE(images[i].length, o + 8)
    head.writeUInt32LE(offset, o + 12)
    offset += images[i].length
  })
  return Buffer.concat([head, ...images])
}

function svg() {
  const f = (n) => n.toFixed(2)
  const pts = []
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * 2 * Math.PI
    const c = Math.cos(a)
    const s = Math.sin(a)
    pts.push(`${f(U / 2 + (U / 2) * Math.sign(c) * Math.abs(c) ** (2 / N))} ${f(U / 2 + (U / 2) * Math.sign(s) * Math.abs(s) ** (2 / N))}`)
  }
  const r = (x, y, w, h, fill) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`
  const tiles = []
  LIT.forEach((row, ri) =>
    row.forEach((lit, ci) => {
      const x = TILES[ci]
      const y = TILES[ri]
      if (!lit) return tiles.push(r(x, y, TILE, TILE, C.off))
      tiles.push(r(x, y, TILE, TILE, C.on), r(x, y, TILE, BEVEL, C.onHi), r(x, y, BEVEL, TILE, C.onHi))
      tiles.push(r(x, y + TILE - BEVEL, TILE, BEVEL, C.onLo), r(x + TILE - BEVEL, y, BEVEL, TILE, C.onLo))
    })
  )
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${U} ${U}"><path d="M${pts.join('L')}Z" fill="${C.bg}"/><g shape-rendering="crispEdges">${tiles.join('')}</g></svg>
`
}

mkdirSync('build', { recursive: true })
writeFileSync('build/icon.png', png(1024))
writeFileSync('build/icon.ico', ico([16, 32, 48, 64, 128, 256]))
writeFileSync('site/favicon.png', png(64))
writeFileSync('site/icon.svg', svg())
mkdirSync('src/renderer/src/assets', { recursive: true })
writeFileSync('src/renderer/src/assets/icon.svg', svg())
console.log('icons written')
