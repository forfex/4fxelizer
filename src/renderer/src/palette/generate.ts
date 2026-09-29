// Palette generation: weighted median cut, Wu, octree and k-means, all in (weighted) OKLab.
// Runs in a worker (palette.worker.ts); pure so it can be unit-tested.

import { oklabToRgb, rgbToOklab, type Vec3 } from '@/color/oklab'
import { hexToOklab, rgb8ToHex, snapHexTo15bit, type GenerateMethod } from './palette'

export interface GenerateOptions {
  method: GenerateMethod
  count: number
  quality: number
  lumaWeight: number
  chromaWeight: number
  /** Colors that must stay in the palette; generation fills the remaining slots around them. */
  locked: string[]
  /** Snap the generated colors to PSX 15-bit color (colors that snap together merge). */
  color15?: boolean
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
  return splitGroups(points, [points.map((_, i) => i)], k)
}

/**
 * Median-cut splitting that starts from the given groups of point indices (each non-empty) and
 * splits until there are `k` groups or no group can be split. Returns each group's mean.
 */
function splitGroups(points: Point[], groups: number[][], k: number): Vec3[] {
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
  const boxes = groups.map(makeBox)
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
 * Tops up a result that came out short of `k` colors (Wu and octree work on a fixed grid, so
 * distinct colors can share a cell, and an octree merge can drop up to 7 leaves at once): every
 * point joins its nearest center, then the worst clusters are split by median cut.
 */
export function fillTo(points: Point[], centers: Vec3[], k: number): Vec3[] {
  if (centers.length >= k || !centers.length) return centers
  const index = new CenterIndex(centers)
  const groups: number[][] = centers.map(() => [])
  points.forEach((pt, i) => groups[index.nearest(pt.p)]!.push(i))
  return splitGroups(points, groups.filter((g) => g.length), k)
}

/** Per-axis minimum and extent of the points (extent at least a tiny epsilon). */
function bounds(points: Point[]): { min: Vec3; size: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const { p } of points) {
    for (let c = 0; c < 3; c++) {
      if (p[c]! < min[c]!) min[c] = p[c]!
      if (p[c]! > max[c]!) max[c] = p[c]!
    }
  }
  return { min, size: [0, 1, 2].map((c) => Math.max(max[c]! - min[c]!, 1e-9)) as Vec3 }
}

/**
 * Wu's quantizer: points are binned into a grid over their bounding box, with cumulative moments
 * (weight, weighted sum, weighted squared length) so any box's variance costs 8 lookups. The box
 * with the largest variance is split repeatedly, at the cut that lowers the total error most.
 * Centers are the exact weighted means of the points in each box.
 */
export function wu(points: Point[], k: number): Vec3[] {
  if (!points.length || k <= 0) return []
  const n = k > 256 ? 64 : 32
  const s = n + 1
  const at = (x: number, y: number, z: number): number => (x * s + y) * s + z
  const W = new Float64Array(s * s * s)
  const M = [new Float64Array(s * s * s), new Float64Array(s * s * s), new Float64Array(s * s * s)]
  const Q = new Float64Array(s * s * s)
  const { min, size } = bounds(points)
  for (const { p, w } of points) {
    const q = [0, 1, 2].map((c) => 1 + Math.min(n - 1, Math.floor(((p[c]! - min[c]!) / size[c]!) * n)))
    const i = at(q[0]!, q[1]!, q[2]!)
    W[i] += w
    for (let c = 0; c < 3; c++) M[c]![i] += w * p[c]!
    Q[i] += w * (p[0] * p[0] + p[1] * p[1] + p[2] * p[2])
  }
  // 3D prefix sums, one axis at a time.
  for (const arr of [W, M[0]!, M[1]!, M[2]!, Q]) {
    for (let x = 1; x < s; x++) for (let y = 1; y < s; y++) for (let z = 1; z < s; z++) arr[at(x, y, z)] += arr[at(x, y, z - 1)]!
    for (let x = 1; x < s; x++) for (let y = 1; y < s; y++) for (let z = 1; z < s; z++) arr[at(x, y, z)] += arr[at(x, y - 1, z)]!
    for (let x = 1; x < s; x++) for (let y = 1; y < s; y++) for (let z = 1; z < s; z++) arr[at(x, y, z)] += arr[at(x - 1, y, z)]!
  }

  /** Box: lower bounds exclusive, upper bounds inclusive (grid indices). */
  interface Box { lo: [number, number, number]; hi: [number, number, number]; v: number }
  const vol = (arr: Float64Array, lo: number[], hi: number[]): number =>
    arr[at(hi[0]!, hi[1]!, hi[2]!)]! - arr[at(hi[0]!, hi[1]!, lo[2]!)]! - arr[at(hi[0]!, lo[1]!, hi[2]!)]! + arr[at(hi[0]!, lo[1]!, lo[2]!)]! -
    arr[at(lo[0]!, hi[1]!, hi[2]!)]! + arr[at(lo[0]!, hi[1]!, lo[2]!)]! + arr[at(lo[0]!, lo[1]!, hi[2]!)]! - arr[at(lo[0]!, lo[1]!, lo[2]!)]!
  const moments = (lo: number[], hi: number[]): [number, number, number, number] => [
    vol(W, lo, hi), vol(M[0]!, lo, hi), vol(M[1]!, lo, hi), vol(M[2]!, lo, hi)
  ]
  const variance = (lo: number[], hi: number[]): number => {
    const [w, a, b, c] = moments(lo, hi)
    const cells = (hi[0]! - lo[0]!) * (hi[1]! - lo[1]!) * (hi[2]! - lo[2]!)
    return w > 0 && cells > 1 ? vol(Q, lo, hi) - (a * a + b * b + c * c) / w : 0
  }
  const makeBox = (lo: [number, number, number], hi: [number, number, number]): Box => ({ lo, hi, v: variance(lo, hi) })

  const boxes = [makeBox([0, 0, 0], [n, n, n])]
  while (boxes.length < k) {
    let best = -1
    for (let i = 0; i < boxes.length; i++) if (boxes[i]!.v > 0 && (best < 0 || boxes[i]!.v > boxes[best]!.v)) best = i
    if (best < 0) break
    const box = boxes[best]!
    const [tw, ta, tb, tc] = moments(box.lo, box.hi)
    // Best cut: maximizes |sum|²/w over both halves (equivalently, minimizes their summed variance).
    let bestScore = -Infinity
    let bestAxis = -1
    let bestCut = 0
    for (let axis = 0; axis < 3; axis++) {
      for (let cut = box.lo[axis]! + 1; cut < box.hi[axis]!; cut++) {
        const hi = [...box.hi]
        hi[axis] = cut
        const [w, a, b, c] = moments(box.lo, hi)
        const w2 = tw - w
        if (w <= 0 || w2 <= 0) continue
        const score = (a * a + b * b + c * c) / w + ((ta - a) ** 2 + (tb - b) ** 2 + (tc - c) ** 2) / w2
        if (score > bestScore) {
          bestScore = score
          bestAxis = axis
          bestCut = cut
        }
      }
    }
    if (bestAxis < 0) {
      box.v = 0 // All points share one cell: can't split further.
      continue
    }
    const loHi = [...box.hi] as [number, number, number]
    loHi[bestAxis] = bestCut
    const hiLo = [...box.lo] as [number, number, number]
    hiLo[bestAxis] = bestCut
    boxes.splice(best, 1, makeBox(box.lo, loHi), makeBox(hiLo, box.hi))
  }
  return boxes.map((b) => {
    const [w, a, bb, c] = moments(b.lo, b.hi)
    return [a / w, bb / w, c / w] as Vec3
  })
}

/**
 * Octree quantizer: points go into a 64-per-axis octree over a cube around them (a cube, so the
 * luma/chroma weights still shape the result). Then the node whose leaf children cost the least
 * error to merge is folded into one leaf, until at most `k` leaves remain. A merge can remove up
 * to 7 leaves, so the result can fall short of `k`; `generatePalette` tops it up with `fillTo`.
 */
export function octree(points: Point[], k: number): Vec3[] {
  if (!points.length || k <= 0) return []
  const DEPTH = 6
  interface Node { w: number; m: Vec3; children: (Node | null)[] | null; parent: Node | null; leaves: number }
  const makeNode = (parent: Node | null, leaf: boolean): Node => ({
    w: 0, m: [0, 0, 0], children: leaf ? null : [null, null, null, null, null, null, null, null], parent, leaves: 0
  })
  const { min, size } = bounds(points)
  const extent = Math.max(size[0], size[1], size[2])
  const side = 1 << DEPTH
  const root = makeNode(null, false)
  let leafCount = 0
  for (const { p, w } of points) {
    const q = [0, 1, 2].map((c) => Math.min(side - 1, Math.floor(((p[c]! - min[c]!) / extent) * side)))
    let node = root
    for (let level = DEPTH - 1; level >= 0; level--) {
      node.w += w
      for (let c = 0; c < 3; c++) node.m[c] += w * p[c]!
      const child = (((q[0]! >> level) & 1) << 2) | (((q[1]! >> level) & 1) << 1) | ((q[2]! >> level) & 1)
      let next = node.children![child]!
      if (!next) {
        next = node.children![child] = makeNode(node, level === 0)
        if (level === 0) leafCount++
      }
      node = next
    }
    node.w += w
    for (let c = 0; c < 3; c++) node.m[c] += w * p[c]!
  }

  // Cost of folding a node's children into it: the weighted squared error the merge adds.
  const mergeCost = (node: Node): number => {
    const mean = node.m.map((v) => v / node.w)
    let cost = 0
    for (const ch of node.children!) {
      if (!ch) continue
      cost += ch.w * dist2(ch.m.map((v) => v / ch.w) as Vec3, mean as Vec3)
    }
    return cost
  }
  const allLeafChildren = (node: Node): boolean => node.children!.every((ch) => !ch || !ch.children)

  // Binary min-heap of nodes whose children are all leaves.
  const heap: { cost: number; node: Node }[] = []
  const push = (node: Node): void => {
    heap.push({ cost: mergeCost(node), node })
    let i = heap.length - 1
    while (i > 0) {
      const up = (i - 1) >> 1
      if (heap[up]!.cost <= heap[i]!.cost) break
      ;[heap[up], heap[i]] = [heap[i]!, heap[up]!]
      i = up
    }
  }
  const pop = (): Node => {
    const top = heap[0]!.node
    const last = heap.pop()!
    if (heap.length) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < heap.length && heap[l]!.cost < heap[m]!.cost) m = l
        if (r < heap.length && heap[r]!.cost < heap[m]!.cost) m = r
        if (m === i) break
        ;[heap[m], heap[i]] = [heap[i]!, heap[m]!]
        i = m
      }
    }
    return top
  }
  const visit = (node: Node): void => {
    if (!node.children) return
    node.children.forEach((ch) => ch && visit(ch))
    if (allLeafChildren(node)) push(node)
  }
  visit(root)

  while (leafCount > k && heap.length) {
    const node = pop()
    leafCount -= node.children!.filter(Boolean).length - 1
    node.children = null
    if (node.parent && allLeafChildren(node.parent)) push(node.parent)
  }

  const out: Vec3[] = []
  const collect = (node: Node): void => {
    if (!node.children) out.push(node.m.map((v) => v / node.w) as Vec3)
    else node.children.forEach((ch) => ch && collect(ch))
  }
  collect(root)
  return out
}

/**
 * Nearest-center search over centers sorted by their first coordinate (lightness). The squared
 * lightness difference is a lower bound on the full distance, so the scan stops early in both
 * directions. Returns exactly what a linear scan would (ties go to the lowest center index).
 */
export class CenterIndex {
  private readonly order: Int32Array
  private readonly keys: Float64Array

  constructor(private readonly centers: Vec3[]) {
    this.order = Int32Array.from(centers.keys()).sort((a, b) => centers[a]![0] - centers[b]![0] || a - b)
    this.keys = Float64Array.from(this.order, (c) => centers[c]![0])
  }

  nearest(p: Vec3): number {
    const { order, keys, centers } = this
    let lo = 0
    let hi = keys.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (keys[mid]! < p[0]) lo = mid + 1
      else hi = mid
    }
    let best = -1
    let bestD = Infinity
    const consider = (j: number): boolean => {
      const dl = keys[j]! - p[0]
      if (dl * dl > bestD) return false
      const c = order[j]!
      const d = dist2(p, centers[c]!)
      if (d < bestD || (d === bestD && c < best)) {
        bestD = d
        best = c
      }
      return true
    }
    for (let j = lo; j < keys.length && consider(j); j++);
    for (let j = lo - 1; j >= 0 && consider(j); j--);
    return best
  }
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
    const index = new CenterIndex(centers)
    for (let i = 0; i < points.length; i++) {
      const pt = points[i]!
      const best = index.nearest(pt.p)
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
  let centers = opts.method === 'wu' ? wu(points, want) : opts.method === 'octree' ? octree(points, want) : medianCut(points, want)
  centers = fillTo(points, centers, want)
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
    const exact = rgb8ToHex(r * 255, g * 255, b * 255)
    const hex = opts.color15 ? snapHexTo15bit(exact) : exact
    if (seen.has(hex)) continue
    seen.add(hex)
    out.push({ hex, L: lab[0] })
  }
  return out.sort((a, b) => a.L - b.L).map((c) => c.hex)
}
