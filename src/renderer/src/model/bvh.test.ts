import { describe, expect, it } from 'vitest'
import { buildBvh, intersectTriangle, leafIndexOf, MAX_DEPTH, NODE_WORDS, traceBvh, type Vec3 } from './bvh'

/** Deterministic pseudo-random numbers. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function randomMesh(count: number, seed: number): { positions: Float32Array; indices: Uint32Array } {
  const r = rng(seed)
  const positions = new Float32Array(count * 9)
  for (let t = 0; t < count; t++) {
    const c = [r() * 10 - 5, r() * 10 - 5, r() * 10 - 5]
    for (let v = 0; v < 3; v++) for (let a = 0; a < 3; a++) positions[t * 9 + v * 3 + a] = c[a]! + r() - 0.5
  }
  return { positions, indices: Uint32Array.from({ length: count * 3 }, (_, i) => i) }
}

function depthOf(nodes: Uint32Array, n = 0): number {
  if (nodes[n * NODE_WORDS + 7]) return 1
  const left = nodes[n * NODE_WORDS + 3]!
  return 1 + Math.max(depthOf(nodes, left), depthOf(nodes, left + 1))
}

describe('buildBvh', () => {
  it('finds the same closest hits as testing every triangle', () => {
    const mesh = randomMesh(600, 1)
    const bvh = buildBvh(mesh.positions, mesh.indices)
    const r = rng(2)
    let hits = 0
    for (let i = 0; i < 400; i++) {
      const o: Vec3 = [r() * 16 - 8, r() * 16 - 8, r() * 16 - 8]
      // Aim at a random point inside the cloud so plenty of rays hit.
      const d0 = [r() * 8 - 4 - o[0], r() * 8 - 4 - o[1], r() * 8 - 4 - o[2]]
      const len = Math.hypot(...d0)
      const d = d0.map((x) => x / len) as Vec3
      let best = Infinity
      for (let k = 0; k < 600; k++) {
        const t = intersectTriangle(bvh, k, o, d, 0, best)
        if (t >= 0) best = t
      }
      const hit = traceBvh(bvh, o, d, 0, Infinity)
      if (best === Infinity) expect(hit).toBeNull()
      else {
        hits++
        expect(hit!.t).toBeCloseTo(best, 5)
      }
    }
    expect(hits).toBeGreaterThan(100)
  })

  it('keeps every triangle exactly once, in leaves of a bounded tree', () => {
    const mesh = randomMesh(1000, 3)
    const bvh = buildBvh(mesh.positions, mesh.indices)
    expect([...bvh.order].sort((a, b) => a - b)).toEqual([...Array(1000).keys()])
    const inverse = leafIndexOf(bvh)
    expect(bvh.order[inverse[123]!]).toBe(123)
    let inLeaves = 0
    for (let n = 0; n < bvh.nodes.length / NODE_WORDS; n++) inLeaves += bvh.nodes[n * NODE_WORDS + 7]!
    expect(inLeaves).toBe(1000)
    expect(depthOf(bvh.nodes)).toBeLessThanOrEqual(MAX_DEPTH + 1)
  })

  it('stores triangles as a corner and two edges in leaf order', () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 2, 0])
    const bvh = buildBvh(positions, new Uint32Array([0, 1, 2]))
    expect([...bvh.triangles]).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0])
    expect(traceBvh(bvh, [0.2, 0.2, 1], [0, 0, -1], 0, 10)).toEqual({ triangle: 0, t: 1 })
    expect(traceBvh(bvh, [0.2, 0.2, 1], [0, 0, -1], 0, 0.5)).toBeNull()
  })

  it('handles many triangles with the same centroid', () => {
    const tri = [0, 0, 0, 1, 0, 0, 0, 1, 0]
    const positions = new Float32Array(Array.from({ length: 100 }, () => tri).flat())
    const bvh = buildBvh(positions, Uint32Array.from({ length: 300 }, (_, i) => i))
    expect(bvh.order.length).toBe(100)
    expect(traceBvh(bvh, [0.2, 0.2, 1], [0, 0, -1], 0, 10)?.t).toBeCloseTo(1)
  })

  it('builds an empty tree for an empty mesh', () => {
    const bvh = buildBvh(new Float32Array(0), new Uint32Array(0))
    expect(traceBvh(bvh, [0, 0, 0], [0, 0, 1], 0, 10)).toBeNull()
  })
})
