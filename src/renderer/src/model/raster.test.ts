import { describe, expect, it } from 'vitest'
import { COVERED, EMPTY_TRIANGLE, PADDED, rasterizeUv, type GBufferInput } from './raster'

/** A quad of two triangles covering `uv` rectangle [u0,u1]×[v0,v1], lying in the z = 0 plane at world (u, v). */
function quad(u0: number, v0: number, u1: number, v1: number, extra: Partial<GBufferInput> = {}): GBufferInput {
  const uv = new Float32Array([u0, v0, u1, v0, u1, v1, u0, v1])
  const positions = new Float32Array([u0, v0, 0, u1, v0, 0, u1, v1, 0, u0, v1, 0])
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1])
  return { positions, normals, uv, indices: new Uint32Array([0, 1, 2, 0, 2, 3]), first: 0, count: 2, leafIndex: new Uint32Array([7, 9]), ...extra }
}

const bits = (g: { position: Float32Array }, i: number): number => new Uint32Array(g.position.buffer)[i * 4 + 3]!

describe('rasterizeUv', () => {
  it('covers the texels inside the UV island, interpolating the surface point', () => {
    const g = rasterizeUv(quad(0, 0, 0.5, 0.5), 8, 8)
    expect(g.covered).toBe(16)
    expect(g.overlapping).toBe(0) // the shared diagonal isn't an overlap
    const i = 1 * 8 + 2 // texel (2, 1), center uv (2.5/8, 1.5/8)
    expect(g.position[i * 4]).toBeCloseTo(2.5 / 8)
    expect(g.position[i * 4 + 1]).toBeCloseTo(1.5 / 8)
    expect([...g.normal.slice(i * 4, i * 4 + 4)]).toEqual([0, 0, 1, COVERED])
    expect([7, 9]).toContain(bits(g, i))
    expect(bits(g, 5 * 8 + 5)).toBe(EMPTY_TRIANGLE)
    expect(g.normal[(5 * 8 + 5) * 4 + 3]).toBe(0)
  })

  it('keeps thin triangles that miss every texel center', () => {
    // A sliver 0.3 texels tall across the texel row y = 2, between the centers (2.5) and the quarter points.
    const uv = new Float32Array([0, 2.6 / 8, 1, 2.6 / 8, 1, 2.9 / 8])
    const input: GBufferInput = { ...quad(0, 0, 1, 1), uv, indices: new Uint32Array([0, 1, 2]), count: 1 }
    const g = rasterizeUv(input, 8, 8)
    expect(g.covered).toBeGreaterThan(0)
  })

  it('counts texels covered twice (overlapping or mirrored UVs)', () => {
    const one = quad(0, 0, 0.5, 0.5)
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]) // the same quad again, mirrored winding
    const g = rasterizeUv({ ...one, indices, count: 4, leafIndex: new Uint32Array(4) }, 8, 8)
    expect(g.covered).toBe(16)
    // Every texel but those on the diagonal (inside both triangles' shared edge) is doubled.
    expect(g.overlapping).toBe(12)
  })

  it('pads islands outward by the given number of texels', () => {
    const g = rasterizeUv(quad(0.25, 0.25, 0.75, 0.75), 16, 16, 2)
    expect(g.covered).toBe(64)
    const at = (x: number, y: number): number => g.normal[(y * 16 + x) * 4 + 3]!
    expect(at(4, 4)).toBe(COVERED)
    expect(at(3, 4)).toBe(PADDED)
    expect(at(2, 2)).toBe(PADDED)
    expect(at(1, 4)).toBe(0)
    // Padded texels repeat their neighbor's surface point.
    expect(g.position[(4 * 16 + 3) * 4]).toBeCloseTo(g.position[(4 * 16 + 4) * 4]!)
  })

  it('wraps UVs outside 0–1 onto the texture', () => {
    const g = rasterizeUv(quad(1, 1, 1.5, 1.5), 8, 8)
    expect(g.covered).toBe(16)
    expect(g.normal[(1 * 8 + 1) * 4 + 3]).toBe(COVERED)
  })

  it('draws only the given triangle range', () => {
    const g = rasterizeUv({ ...quad(0, 0, 1, 1), first: 1, count: 1 }, 8, 8)
    expect(g.covered).toBeLessThan(40)
    expect(g.covered).toBeGreaterThan(24)
  })
})
