// Bounding-volume hierarchy over a mesh's triangles, built on the CPU (binned SAH) in a flat layout
// the bake shaders traverse directly (see BVH_WGSL in gpu/bake/bakeLib.ts, which must match
// `traceBvh` below).
//
// Node layout, 8 words (32 bytes): min.xyz (f32), leftOrFirst (u32), max.xyz (f32), count (u32).
// Inner nodes have count 0 and their children at leftOrFirst and leftOrFirst + 1; leaves hold
// `count` triangles starting at leftOrFirst in `triangles`.

export interface Bvh {
  nodes: Uint32Array<ArrayBuffer>
  /** Triangles in leaf order, 12 floats each: v0.xyz, 0, edge1.xyz, 0, edge2.xyz, 0. */
  triangles: Float32Array<ArrayBuffer>
  /** Original triangle index of each triangle in `triangles`. */
  order: Uint32Array<ArrayBuffer>
}

export const NODE_WORDS = 8
export const TRIANGLE_FLOATS = 12
/** Leaves hold at most this many triangles (unless they can't be split). */
const LEAF_SIZE = 4
const BINS = 12
/** Deepest the tree gets (the shaders' traversal stack must hold this many entries). */
export const MAX_DEPTH = 48

export function buildBvh(positions: Float32Array, indices: Uint32Array): Bvh {
  const n = indices.length / 3
  // Per-triangle bounds and centroids.
  const bmin = new Float32Array(n * 3)
  const bmax = new Float32Array(n * 3)
  const cen = new Float32Array(n * 3)
  for (let t = 0; t < n; t++) {
    for (let a = 0; a < 3; a++) {
      const x = positions[indices[t * 3]! * 3 + a]!
      const y = positions[indices[t * 3 + 1]! * 3 + a]!
      const z = positions[indices[t * 3 + 2]! * 3 + a]!
      bmin[t * 3 + a] = Math.min(x, y, z)
      bmax[t * 3 + a] = Math.max(x, y, z)
      cen[t * 3 + a] = (x + y + z) / 3
    }
  }
  const order = new Uint32Array(n)
  for (let t = 0; t < n; t++) order[t] = t

  let capacity = Math.max(2 * n, 1)
  let words = new Uint32Array(capacity * NODE_WORDS)
  let floats = new Float32Array(words.buffer)
  let used = 1
  const grow = (): void => {
    capacity *= 2
    const next = new Uint32Array(capacity * NODE_WORDS)
    next.set(words)
    words = next
    floats = new Float32Array(words.buffer)
  }

  const setBounds = (node: number, first: number, count: number): void => {
    const lo = [Infinity, Infinity, Infinity]
    const hi = [-Infinity, -Infinity, -Infinity]
    for (let i = first; i < first + count; i++) {
      const t = order[i]!
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a]!, bmin[t * 3 + a]!)
        hi[a] = Math.max(hi[a]!, bmax[t * 3 + a]!)
      }
    }
    const o = node * NODE_WORDS
    floats[o] = lo[0]!
    floats[o + 1] = lo[1]!
    floats[o + 2] = lo[2]!
    floats[o + 4] = hi[0]!
    floats[o + 5] = hi[1]!
    floats[o + 6] = hi[2]!
  }

  const area = (lo: number[], hi: number[]): number => {
    const dx = hi[0]! - lo[0]!
    const dy = hi[1]! - lo[1]!
    const dz = hi[2]! - lo[2]!
    return dx < 0 ? 0 : 2 * (dx * dy + dy * dz + dz * dx)
  }

  const makeLeaf = (node: number, first: number, count: number): void => {
    words[node * NODE_WORDS + 3] = first
    words[node * NODE_WORDS + 7] = count
  }

  // Iterative build: [node, first, count, depth].
  const stack: [number, number, number, number][] = [[0, 0, n, 0]]
  if (n) setBounds(0, 0, n)
  else makeLeaf(0, 0, 0)
  const binCount = new Int32Array(BINS)
  const binLo = new Float64Array(BINS * 3)
  const binHi = new Float64Array(BINS * 3)
  const rightArea = new Float64Array(BINS)
  const rightCount = new Int32Array(BINS)

  while (stack.length && n) {
    const [node, first, count, depth] = stack.pop()!
    if (count <= LEAF_SIZE || depth >= MAX_DEPTH) {
      makeLeaf(node, first, count)
      continue
    }
    // Centroid bounds pick the binning range.
    const clo = [Infinity, Infinity, Infinity]
    const chi = [-Infinity, -Infinity, -Infinity]
    for (let i = first; i < first + count; i++) {
      const t = order[i]!
      for (let a = 0; a < 3; a++) {
        clo[a] = Math.min(clo[a]!, cen[t * 3 + a]!)
        chi[a] = Math.max(chi[a]!, cen[t * 3 + a]!)
      }
    }
    let bestCost = Infinity
    let bestAxis = -1
    let bestSplit = 0
    for (let axis = 0; axis < 3; axis++) {
      const extent = chi[axis]! - clo[axis]!
      if (extent <= 0) continue
      binCount.fill(0)
      binLo.fill(Infinity)
      binHi.fill(-Infinity)
      const scale = BINS / extent
      for (let i = first; i < first + count; i++) {
        const t = order[i]!
        const b = Math.min(BINS - 1, Math.floor((cen[t * 3 + axis]! - clo[axis]!) * scale))
        binCount[b]!++
        for (let a = 0; a < 3; a++) {
          binLo[b * 3 + a] = Math.min(binLo[b * 3 + a]!, bmin[t * 3 + a]!)
          binHi[b * 3 + a] = Math.max(binHi[b * 3 + a]!, bmax[t * 3 + a]!)
        }
      }
      // Sweep from the right, then from the left.
      const lo = [Infinity, Infinity, Infinity]
      const hi = [-Infinity, -Infinity, -Infinity]
      let c = 0
      for (let b = BINS - 1; b > 0; b--) {
        c += binCount[b]!
        for (let a = 0; a < 3; a++) {
          lo[a] = Math.min(lo[a]!, binLo[b * 3 + a]!)
          hi[a] = Math.max(hi[a]!, binHi[b * 3 + a]!)
        }
        rightCount[b] = c
        rightArea[b] = area(lo, hi)
      }
      lo.fill(Infinity)
      hi.fill(-Infinity)
      c = 0
      for (let b = 0; b < BINS - 1; b++) {
        c += binCount[b]!
        for (let a = 0; a < 3; a++) {
          lo[a] = Math.min(lo[a]!, binLo[b * 3 + a]!)
          hi[a] = Math.max(hi[a]!, binHi[b * 3 + a]!)
        }
        const rc = rightCount[b + 1]!
        if (!c || !rc) continue
        const cost = c * area(lo, hi) + rc * rightArea[b + 1]!
        if (cost < bestCost) {
          bestCost = cost
          bestAxis = axis
          bestSplit = b
        }
      }
    }
    const o = node * NODE_WORDS
    const parentArea = area([floats[o]!, floats[o + 1]!, floats[o + 2]!], [floats[o + 4]!, floats[o + 5]!, floats[o + 6]!])
    // Not worth splitting (or all centroids coincide): a leaf, unless it's far too big for one.
    if (bestAxis < 0 || (bestCost >= count * parentArea && count <= LEAF_SIZE * 4)) {
      if (bestAxis < 0 && count > LEAF_SIZE * 4) {
        // Identical centroids: split the list in half so leaves stay small.
        splitAt(node, first, count, first + (count >> 1), depth)
      } else makeLeaf(node, first, count)
      continue
    }
    // Partition by bin.
    const scale = BINS / (chi[bestAxis]! - clo[bestAxis]!)
    let i = first
    let j = first + count - 1
    while (i <= j) {
      const t = order[i]!
      const b = Math.min(BINS - 1, Math.floor((cen[t * 3 + bestAxis]! - clo[bestAxis]!) * scale))
      if (b <= bestSplit) i++
      else {
        order[i] = order[j]!
        order[j] = t
        j--
      }
    }
    splitAt(node, first, count, i, depth)
  }

  function splitAt(node: number, first: number, count: number, mid: number, depth: number): void {
    const leftCount = mid - first
    if (leftCount === 0 || leftCount === count) {
      makeLeaf(node, first, count)
      return
    }
    while (used + 2 > capacity) grow()
    const left = used
    used += 2
    words[node * NODE_WORDS + 3] = left
    words[node * NODE_WORDS + 7] = 0
    setBounds(left, first, leftCount)
    setBounds(left + 1, mid, count - leftCount)
    stack.push([left, first, leftCount, depth + 1], [left + 1, mid, count - leftCount, depth + 1])
  }

  const triangles = new Float32Array(Math.max(n, 1) * TRIANGLE_FLOATS)
  for (let k = 0; k < n; k++) {
    const t = order[k]!
    const a = indices[t * 3]! * 3
    const b = indices[t * 3 + 1]! * 3
    const c = indices[t * 3 + 2]! * 3
    for (let axis = 0; axis < 3; axis++) {
      const v0 = positions[a + axis]!
      triangles[k * TRIANGLE_FLOATS + axis] = v0
      triangles[k * TRIANGLE_FLOATS + 4 + axis] = positions[b + axis]! - v0
      triangles[k * TRIANGLE_FLOATS + 8 + axis] = positions[c + axis]! - v0
    }
  }
  return { nodes: words.slice(0, used * NODE_WORDS), triangles, order }
}

/** Position in `triangles` of each original triangle (inverse of `order`). */
export function leafIndexOf(bvh: Bvh): Uint32Array {
  const inverse = new Uint32Array(bvh.order.length)
  bvh.order.forEach((t, k) => (inverse[t] = k))
  return inverse
}

export type Vec3 = [number, number, number]

/** Ray–triangle intersection (Möller–Trumbore); distance or -1. Mirrors the WGSL. */
export function intersectTriangle(bvh: Bvh, k: number, o: Vec3, d: Vec3, tmin: number, tmax: number): number {
  const tr = bvh.triangles
  const b = k * TRIANGLE_FLOATS
  const e1 = [tr[b + 4]!, tr[b + 5]!, tr[b + 6]!]
  const e2 = [tr[b + 8]!, tr[b + 9]!, tr[b + 10]!]
  const p = [d[1] * e2[2]! - d[2] * e2[1]!, d[2] * e2[0]! - d[0] * e2[2]!, d[0] * e2[1]! - d[1] * e2[0]!]
  const det = e1[0]! * p[0]! + e1[1]! * p[1]! + e1[2]! * p[2]!
  if (Math.abs(det) < 1e-12) return -1
  const inv = 1 / det
  const s = [o[0] - tr[b]!, o[1] - tr[b + 1]!, o[2] - tr[b + 2]!]
  const u = (s[0]! * p[0]! + s[1]! * p[1]! + s[2]! * p[2]!) * inv
  if (u < 0 || u > 1) return -1
  const q = [s[1]! * e1[2]! - s[2]! * e1[1]!, s[2]! * e1[0]! - s[0]! * e1[2]!, s[0]! * e1[1]! - s[1]! * e1[0]!]
  const v = (d[0] * q[0]! + d[1] * q[1]! + d[2] * q[2]!) * inv
  if (v < 0 || u + v > 1) return -1
  const t = (e2[0]! * q[0]! + e2[1]! * q[1]! + e2[2]! * q[2]!) * inv
  return t > tmin && t < tmax ? t : -1
}

/** Closest hit along a ray within (tmin, tmax): leaf-order triangle and distance, or null. */
export function traceBvh(bvh: Bvh, o: Vec3, d: Vec3, tmin: number, tmax: number): { triangle: number; t: number } | null {
  const nodes = bvh.nodes
  const f = new Float32Array(nodes.buffer, nodes.byteOffset, nodes.length)
  const inv = d.map((x) => 1 / x)
  let best = tmax
  let hit = -1
  const stack = [0]
  const boxHit = (n: number): boolean => {
    const b = n * NODE_WORDS
    let t0 = tmin
    let t1 = best
    for (let a = 0; a < 3; a++) {
      const lo = (f[b + a]! - o[a]!) * inv[a]!
      const hi = (f[b + 4 + a]! - o[a]!) * inv[a]!
      t0 = Math.max(t0, Math.min(lo, hi))
      t1 = Math.min(t1, Math.max(lo, hi))
    }
    return t0 <= t1
  }
  while (stack.length) {
    const n = stack.pop()!
    if (!boxHit(n)) continue
    const count = nodes[n * NODE_WORDS + 7]!
    const first = nodes[n * NODE_WORDS + 3]!
    if (count) {
      for (let k = first; k < first + count; k++) {
        const t = intersectTriangle(bvh, k, o, d, tmin, best)
        if (t >= 0) {
          best = t
          hit = k
        }
      }
    } else stack.push(first, first + 1)
  }
  return hit < 0 ? null : { triangle: hit, t: best }
}
