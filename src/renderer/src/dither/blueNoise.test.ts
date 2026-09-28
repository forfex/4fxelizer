import { describe, expect, it } from 'vitest'
import { voidAndCluster } from './blueNoise'

describe('voidAndCluster', () => {
  const size = 32
  const rank = voidAndCluster(size)

  it('assigns every rank exactly once', () => {
    expect([...rank].sort((a, b) => a - b)).toEqual(Array.from({ length: size * size }, (_, i) => i))
  })

  it('is deterministic', () => {
    expect(voidAndCluster(size)).toEqual(rank)
  })

  it('spreads any threshold level evenly (low local variance vs. white noise)', () => {
    // At 50%, every 4×4 block should hold close to 8 "on" texels.
    const on = (x: number, y: number): number => (rank[(y & (size - 1)) * size + (x & (size - 1))]! < (size * size) / 2 ? 1 : 0)
    let worst = 0
    for (let by = 0; by < size; by += 4) {
      for (let bx = 0; bx < size; bx += 4) {
        let count = 0
        for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) count += on(bx + x, by + y)
        worst = Math.max(worst, Math.abs(count - 8))
      }
    }
    // White noise would regularly deviate by 4+.
    expect(worst).toBeLessThanOrEqual(3)
  })
})
