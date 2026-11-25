// The tutorial's sample texture, drawn here so the app ships no extra image: a wall of rounded
// stones with soft shading and color variation, which shows downscaling and color reduction well.

import type { RgbaImage } from '@/image/png'

export const SAMPLE_NAME = 'tutorial-sample.png'
const SIZE = 512
/** Stones per side (the texture tiles). */
const CELLS = 6

/** Repeatable pseudo-random number in 0–1 for a cell. */
function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

const mix = (a: number, b: number, t: number): number => a + (b - a) * t
const smooth = (t: number): number => t * t * (3 - 2 * t)

/** Smooth noise that repeats every `period` cells. */
function noise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const at = (i: number, j: number): number => hash(((i % period) + period) % period, ((j % period) + period) % period, seed)
  const tx = smooth(x - xi)
  const ty = smooth(y - yi)
  return mix(mix(at(xi, yi), at(xi + 1, yi), tx), mix(at(xi, yi + 1), at(xi + 1, yi + 1), tx), ty)
}

export function sampleTexture(): RgbaImage {
  const data = new Uint8Array(SIZE * SIZE * 4)
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const u = (px / SIZE) * CELLS
      const v = (py / SIZE) * CELLS
      // Nearest stone center (jittered grid, wrapping at the edges).
      let best = 9
      let second = 9
      let cx = 0
      let cy = 0
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const gx = Math.floor(u) + i
          const gy = Math.floor(v) + j
          const wx = ((gx % CELLS) + CELLS) % CELLS
          const wy = ((gy % CELLS) + CELLS) % CELLS
          const dx = gx + 0.2 + 0.6 * hash(wx, wy, 1) - u
          const dy = gy + 0.2 + 0.6 * hash(wx, wy, 2) - v
          const d = Math.hypot(dx, dy)
          if (d < best) {
            second = best
            best = d
            cx = wx
            cy = wy
          } else if (d < second) second = d
        }
      }
      // 0 in the gap between stones, 1 on a stone's face.
      const face = Math.min(1, Math.max(0, (second - best) * 4))
      const grain = noise(u * 8, v * 8, CELLS * 8, 3) * 0.5 + noise(u * 24, v * 24, CELLS * 24, 4) * 0.5
      // Each stone has its own tint: warm sandstone to mossy green to slate blue.
      const tint = hash(cx, cy, 5)
      const light = 0.35 + 0.5 * smooth(face) + 0.18 * (grain - 0.5) + 0.12 * (hash(cx, cy, 6) - 0.5)
      // Light comes from the top left.
      const shade = light + 0.1 * (1 - face) * (px + py < (cx + cy + 1) * (SIZE / CELLS) ? 1 : -1)
      const r = mix(mix(0.78, 0.45, tint), 0.4, tint * tint)
      const g = mix(mix(0.62, 0.6, tint), 0.48, tint * tint)
      const b = mix(mix(0.42, 0.38, tint), 0.62, tint * tint)
      const gap = 1 - smooth(Math.min(1, face * 2.5))
      const o = (py * SIZE + px) * 4
      data[o] = Math.round(255 * Math.min(1, Math.max(0, mix(r * shade * 1.25, 0.1, gap))))
      data[o + 1] = Math.round(255 * Math.min(1, Math.max(0, mix(g * shade * 1.25, 0.09, gap))))
      data[o + 2] = Math.round(255 * Math.min(1, Math.max(0, mix(b * shade * 1.25, 0.12, gap))))
      data[o + 3] = 255
    }
  }
  return { width: SIZE, height: SIZE, data }
}
