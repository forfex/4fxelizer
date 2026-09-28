// Blue-noise threshold map via void-and-cluster (Ulichney 1993). Deterministic (seeded), tiles
// seamlessly (toroidal distances), so ordered dithering with it tiles like a Bayer matrix does.

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Returns the rank (0..size²-1) of every texel, row-major. Thresholds are (rank + 0.5) / size².
 * `size` must be a power of two.
 */
export function voidAndCluster(size = 64, sigma = 1.5, seed = 4): Uint32Array {
  const n = size * size
  const mask = size - 1
  // Gaussian energy by toroidal offset.
  const lut = new Float64Array(n)
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const x = Math.min(dx, size - dx)
      const y = Math.min(dy, size - dy)
      lut[dy * size + dx] = Math.exp(-(x * x + y * y) / (2 * sigma * sigma))
    }
  }

  const energy = new Float64Array(n)
  const bits = new Uint8Array(n)
  const toggle = (i: number, on: boolean): void => {
    bits[i] = on ? 1 : 0
    const px = i & mask
    const py = i >> Math.log2(size)
    const sign = on ? 1 : -1
    for (let y = 0; y < size; y++) {
      const row = ((y - py) & mask) * size
      for (let x = 0; x < size; x++) energy[y * size + x] += sign * lut[row + ((x - px) & mask)]!
    }
  }
  const extreme = (wantOnes: boolean, max: boolean): number => {
    let best = -1
    let bestE = max ? -Infinity : Infinity
    for (let i = 0; i < n; i++) {
      if ((bits[i] === 1) !== wantOnes) continue
      const e = energy[i]!
      if (max ? e > bestE : e < bestE) {
        bestE = e
        best = i
      }
    }
    return best
  }

  // Initial pattern: ~10% random points, relaxed until evenly spread.
  const rand = mulberry32(seed)
  const initialOnes = Math.max(1, Math.floor(n / 10))
  let placed = 0
  while (placed < initialOnes) {
    const i = Math.floor(rand() * n)
    if (!bits[i]) {
      toggle(i, true)
      placed++
    }
  }
  for (let guard = 0; guard < n * 4; guard++) {
    const cluster = extreme(true, true)
    toggle(cluster, false)
    const voidIdx = extreme(false, false)
    toggle(voidIdx, true)
    if (voidIdx === cluster) break
  }
  const initial = bits.slice()
  const initialEnergy = energy.slice()

  const rank = new Uint32Array(n)
  // Phase 1: remove the tightest clusters from the initial pattern.
  for (let r = initialOnes - 1; r >= 0; r--) {
    const i = extreme(true, true)
    toggle(i, false)
    rank[i] = r
  }
  // Phases 2 + 3: from the initial pattern, fill the largest voids.
  bits.set(initial)
  energy.set(initialEnergy)
  for (let r = initialOnes; r < n; r++) {
    const i = extreme(false, false)
    toggle(i, true)
    rank[i] = r
  }
  return rank
}

let cached: Uint8Array | null = null

/** 64×64 blue-noise thresholds as 8-bit values (row-major), computed once. */
export function blueNoise64(): Uint8Array {
  if (!cached) {
    const rank = voidAndCluster(64)
    cached = new Uint8Array(rank.length)
    for (let i = 0; i < rank.length; i++) cached[i] = Math.floor((rank[i]! * 256) / rank.length)
  }
  return cached
}
