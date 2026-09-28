// Palette generation: weighted median cut and k-means, both in (weighted) OKLab.
// Runs in a worker (palette.worker.ts); pure so it can be unit-tested.

import { oklabToRgb, rgbToOklab, type Vec3 } from '@/color/oklab'
import { hexToOklab, rgb8ToHex, type GenerateMethod } from './palette'

export interface GenerateOptions {
  method: GenerateMethod
  count: number
  quality: number
  lumaWeight: number
  chromaWeight: number
  /** Colors that must stay in the palette; generation fills the remaining slots around them. */
  locked: string[]
}

interface Point {
  /** Weighted OKLab position. */
  p: Vec3
  w: number
}

/**
 * Buckets straight RGBA8 pixels into a 15-bit histogram (pixels below the alpha cutoff are ignored).
 * Each bucket keeps its mean color, so the bucketing costs no color precision.
 */
export function histogram(rgba: Uint8Array, alphaCutoff = 128): { rgb: Vec3; w: number }[] {
  const count = new Uint32Array(32768)
  const sum = new Float64Array(32768 * 3)
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3]! < alphaCutoff) continue
    const r = rgba[i]!
    const g = rgba[i + 1]!
    const b = rgba[i + 2]!
    const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    count[k]!++
    sum[k * 3] += r
    sum[k * 3 + 1] += g
    sum[k * 3 + 2] += b
  }
  const bins: { rgb: Vec3; w: number }[] = []
  for (let k = 0; k < 32768; k++) {
    const n = count[k]!
    if (n) bins.push({ rgb: [sum[k * 3]! / n / 255, sum[k * 3 + 1]! / n / 255, sum[k * 3 + 2]! / n / 255], w: n })
  }
  return bins
}

function weigh([L, a, b]: Vec3, lw: number, cw: number): Vec3 {
  return [L * lw, a * cw, b * cw]
}

function unweigh([L, a, b]: Vec3, lw: number, cw: number): Vec3 {
  return [L / lw, a / cw, b / cw]
}

function dist2(a: Vec3, b: Vec3): number {
  const x = a[0] - b[0]
  const y = a[1] - b[1]
  const z = a[2] - b[2]
  return x * x + y * y + z * z
}

function mean(points: Point[], idx: number[]): Vec3 {
  let w = 0
  const m: Vec3 = [0, 0, 0]
  for (const i of idx) {
    const pt = points[i]!
    w += pt.w
    for (let c = 0; c < 3; c++) m[c] += pt.p[c]! * pt.w
  }
  return m.map((v) => v / (w || 1)) as Vec3
}

/** Weighted median cut: repeatedly split the box with the largest squared error at its weighted median. */
export function medianCut(points: Point[], k: number): Vec3[] {
  if (!points.length || k <= 0) return []
  interface Box { idx: number[]; sse: number; axis: number }
  const makeBox = (idx: number[]): Box => {
    const m = mean(points, idx)
    const v: Vec3 = [0, 0, 0]
    for (const i of idx) {
      const pt = points[i]!
      for (let c = 0; c < 3; c++) v[c] += pt.w * (pt.p[c]! - m[c]!) ** 2
    }
    const axis = v[0] >= v[1] && v[0] >= v[2] ? 0 : v[1] >= v[2] ? 1 : 2
    return { idx, sse: idx.length > 1 ? v[0] + v[1] + v[2] : 0, axis }
  }
  const boxes = [makeBox(points.map((_, i) => i))]
  while (boxes.length < k) {
    let best = -1
    for (let i = 0; i < boxes.length; i++) if (boxes[i]!.sse > 0 && (best < 0 || boxes[i]!.sse > boxes[best]!.sse)) best = i
    if (best < 0) break
    const box = boxes[best]!
    const sorted = [...box.idx].sort((a, b) => points[a]!.p[box.axis]! - points[b]!.p[box.axis]!)
    const total = sorted.reduce((s, i) => s + points[i]!.w, 0)
    let acc = 0
    let cut = 1
    for (let i = 0; i < sorted.length - 1; i++) {
      acc += points[sorted[i]!]!.w
      cut = i + 1
      if (acc >= total / 2) break
    }
    boxes.splice(best, 1, makeBox(sorted.slice(0, cut)), makeBox(sorted.slice(cut)))
  }
  return boxes.map((b) => mean(points, b.idx))
}

/**
 * Weighted k-means (Lloyd). The first `fixed` centers never move (locked colors).
 * Empty clusters are re-seeded at the point with the largest weighted error.
 */
export function kmeans(points: Point[], initial: Vec3[], fixed: number, iterations: number): Vec3[] {
  const centers = initial.map((c) => [...c] as Vec3)
  const k = centers.length
  if (!points.length || k === fixed) return centers
  const assign = new Int32Array(points.length).fill(-1)
  for (let it = 0; it < iterations; it++) {
    let changed = false
    const sums = Array.from({ length: k }, () => [0, 0, 0, 0])
    for (let i = 0; i < points.length; i++) {
      const pt = points[i]!
      let best = 0
      let bestD = Infinity
      for (let c = 0; c < k; c++) {
        const d = dist2(pt.p, centers[c]!)
        if (d < bestD) {
          bestD = d
          best = c
        }
      }
      if (assign[i] !== best) {
        assign[i] = best
        changed = true
      }
      const s = sums[best]!
      s[0] += pt.p[0] * pt.w
      s[1] += pt.p[1] * pt.w
      s[2] += pt.p[2] * pt.w
      s[3] += pt.w
    }
    for (let c = fixed; c < k; c++) {
      const s = sums[c]!
      if (s[3]! > 0) {
        centers[c] = [s[0]! / s[3]!, s[1]! / s[3]!, s[2]! / s[3]!]
      } else {
        let worst = 0
        let worstE = -1
        for (let i = 0; i < points.length; i++) {
          const e = dist2(points[i]!.p, centers[assign[i]!]!) * points[i]!.w
          if (e > worstE) {
            worstE = e
            worst = i
          }
        }
        centers[c] = [...points[worst]!.p]
        changed = true
      }
    }
    if (!changed) break
  }
  return centers
}

/** Generates up to `count - locked.length` new colors (hex, sorted dark → light). */
export function generatePalette(rgba: Uint8Array, opts: GenerateOptions): string[] {
  const lw = Math.max(opts.lumaWeight, 0.05)
  const cw = Math.max(opts.chromaWeight, 0.05)
  const points: Point[] = histogram(rgba).map((b) => ({ p: weigh(rgbToOklab(b.rgb), lw, cw), w: b.w }))
  const want = Math.min(Math.max(opts.count - opts.locked.length, 0), points.length)
  if (want === 0) return []

  const lockedCenters = opts.locked.map((hex) => weigh(hexToOklab(hex), lw, cw))
  let centers = medianCut(points, want)
  if (opts.method === 'kmeans' && opts.quality > 0) {
    centers = kmeans(points, [...lockedCenters, ...centers], lockedCenters.length, opts.quality).slice(
      lockedCenters.length
    )
  }

  const seen = new Set(opts.locked)
  const out: { hex: string; L: number }[] = []
  for (const c of centers) {
    const lab = unweigh(c, lw, cw)
    const [r, g, b] = oklabToRgb(lab)
    const hex = rgb8ToHex(r * 255, g * 255, b * 255)
    if (seen.has(hex)) continue
    seen.add(hex)
    out.push({ hex, L: lab[0] })
  }
  return out.sort((a, b) => a.L - b.L).map((c) => c.hex)
}
