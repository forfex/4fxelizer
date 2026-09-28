// Generates the app icon: a 4x4 Bayer threshold matrix drawn as bevelled cells.
// Usage: node scripts/make-icon.mjs   (writes build/icon.png, build/icon.ico, site/icon.svg, site/favicon.png)
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
]
const C = {
  bg: '#1d1c1a',
  frameHi: '#5a5648',
  frameLo: '#0e0d0b',
  off: '#2b2a27',
  mid: '#7a5a18',
  on: '#d9a441',
  onHi: '#f0c878',
  onLo: '#8f6a1c'
}
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const tier = (v) => (v < 5 ? 'on' : v < 10 ? 'mid' : 'off')

// Layout on a 64-unit grid: 2-unit bevelled frame, 5-unit margin, 4x4 cells of 12 units with 2-unit gaps.
const U = 64
const PAD = 5
const CELL = 12
const GAP = 2

/** RGBA pixels for a size x size icon, rendered by shading each pixel from the layout above. */
function render(size) {
  const px = Buffer.alloc(size * size * 4)
  const set = (x, y, hex) => px.set([...rgb(hex), 255], (y * size + x) * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = ((x + 0.5) / size) * U
      const v = ((y + 0.5) / size) * U
      let color = C.bg
      // outer bevel
      const e = Math.min(u, v, U - u, U - v)
      if (e < 2) color = u + v < U ? C.frameHi : C.frameLo
      else {
        const cu = u - PAD
        const cv = v - PAD
        const step = CELL + GAP
        const col = Math.floor(cu / step)
        const row = Math.floor(cv / step)
        const lu = cu - col * step
        const lv = cv - row * step
        if (col >= 0 && col < 4 && row >= 0 && row < 4 && lu < CELL && lv < CELL) {
          const t = tier(BAYER[row][col])
          color = C[t]
          if (t !== 'off') {
            // raised bevel on lit cells; sunken cells stay flat
            if (lu < 1.5 || lv < 1.5) color = t === 'on' ? C.onHi : C.on
            else if (lu > CELL - 1.5 || lv > CELL - 1.5) color = t === 'on' ? C.onLo : C.frameLo
          }
        }
      }
      set(x, y, color)
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
  const r = (x, y, w, h, f) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${f}"/>`
  // frame: light top-left, dark bottom-right (diagonal split), then the background inset
  const parts = [
    r(0, 0, U, U, C.frameHi),
    `<path d="M${U} 0V${U}H0z" fill="${C.frameLo}"/>`,
    r(2, 2, U - 4, U - 4, C.bg)
  ]
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const t = tier(BAYER[row][col])
      const x = PAD + col * (CELL + GAP)
      const y = PAD + row * (CELL + GAP)
      parts.push(r(x, y, CELL, CELL, C[t]))
      if (t !== 'off') {
        const hi = t === 'on' ? C.onHi : C.on
        const lo = t === 'on' ? C.onLo : C.frameLo
        parts.push(r(x, y, CELL, 1.5, hi), r(x, y, 1.5, CELL, hi))
        parts.push(r(x, y + CELL - 1.5, CELL, 1.5, lo), r(x + CELL - 1.5, y, 1.5, CELL, lo))
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${U} ${U}" shape-rendering="crispEdges">${parts.join('')}</svg>\n`
}

mkdirSync('build', { recursive: true })
writeFileSync('build/icon.png', png(1024))
writeFileSync('build/icon.ico', ico([16, 32, 48, 64, 128, 256]))
writeFileSync('site/favicon.png', png(64))
writeFileSync('site/icon.svg', svg())
console.log('icons written')
