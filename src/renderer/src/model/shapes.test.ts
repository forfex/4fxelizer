import { describe, expect, it } from 'vitest'
import { VIEW3D_SHAPES } from '@shared/view3d'
import { shapeModel } from './shapes'

describe('built-in shapes', () => {
  for (const shape of VIEW3D_SHAPES) {
    it(`${shape}: faces wind counter-clockwise around outward normals`, () => {
      const m = shapeModel(shape)
      const p = m.positions
      const n = m.normals
      expect(m.parts).toEqual([{ first: 0, count: m.indices.length / 3 }])
      expect(m.uvSets[0]!.length / 2).toBe(p.length / 3)
      let checked = 0
      for (let t = 0; t < m.indices.length; t += 3) {
        const [a, b, c] = [m.indices[t]!, m.indices[t + 1]!, m.indices[t + 2]!]
        const e1 = [0, 1, 2].map((k) => p[b * 3 + k]! - p[a * 3 + k]!)
        const e2 = [0, 1, 2].map((k) => p[c * 3 + k]! - p[a * 3 + k]!)
        const face = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!]
        const area = Math.hypot(...face)
        if (area < 1e-9) continue // the sphere's poles
        const normal = [0, 1, 2].map((k) => n[a * 3 + k]! + n[b * 3 + k]! + n[c * 3 + k]!)
        expect(face[0]! * normal[0]! + face[1]! * normal[1]! + face[2]! * normal[2]!).toBeGreaterThan(0)
        checked++
      }
      expect(checked).toBeGreaterThan(0)
      for (let i = 0; i < 3; i++) expect(m.bounds.max[i]).toBeGreaterThanOrEqual(m.bounds.min[i]!)
    })
  }

  it('tiles the texture twice on the tiled sphere', () => {
    const once = shapeModel('sphere').uvSets[0]!
    const twice = shapeModel('sphere-tiled').uvSets[0]!
    expect(Math.max(...twice)).toBeCloseTo(2 * Math.max(...once))
  })
})
