import { describe, expect, it } from 'vitest'
import { dolly, eye, frameBounds, lightProjection, orbit, panCamera, transformPoint, viewProjection, type OrbitCamera, type Vec3 } from './camera'

const bounds = { min: [-1, 0, -0.5] as Vec3, max: [1, 3, 0.5] as Vec3 }
const radius = Math.hypot(2, 3, 1) / 2

function ndc(c: OrbitCamera, aspect: number, p: Vec3): [number, number, number] {
  const [x, y, z, w] = transformPoint(viewProjection(c, aspect, radius), p)
  return [x / w, y / w, z / w]
}

describe('orbit camera', () => {
  it('puts the target in the middle of the view, between the depth planes', () => {
    const c = frameBounds(bounds, 1.5)
    const [x, y, z] = ndc(c, 1.5, c.target)
    expect(x).toBeCloseTo(0)
    expect(y).toBeCloseTo(0)
    expect(z).toBeGreaterThan(0)
    expect(z).toBeLessThan(1)
  })

  it('frames the whole model at any aspect ratio', () => {
    for (const aspect of [0.3, 1, 2.5]) {
      const c = frameBounds(bounds, aspect)
      for (const x of [-1, 1]) for (const y of [0, 3]) for (const z of [-0.5, 0.5]) {
        const p = ndc(c, aspect, [x, y, z])
        expect(Math.abs(p[0])).toBeLessThanOrEqual(1)
        expect(Math.abs(p[1])).toBeLessThanOrEqual(1)
        expect(p[2]).toBeGreaterThanOrEqual(0)
        expect(p[2]).toBeLessThanOrEqual(1)
      }
    }
  })

  it('keeps up as up: a point above the target is higher on screen', () => {
    const c = frameBounds(bounds, 1)
    expect(ndc(c, 1, [0, 2, 0])[1]).toBeGreaterThan(ndc(c, 1, [0, 1, 0])[1])
  })

  it('orbits around the target without flipping over the top', () => {
    const c = frameBounds(bounds, 1)
    const d = Math.hypot(...eye(c).map((v, i) => v - c.target[i]!))
    const turned = orbit(c, 300, 10000)
    expect(turned.pitch).toBeLessThan(Math.PI / 2)
    expect(Math.hypot(...eye(turned).map((v, i) => v - turned.target[i]!))).toBeCloseTo(d)
  })

  it('pans so the grabbed point follows the pointer', () => {
    const c = frameBounds(bounds, 1)
    const moved = panCamera(c, 50, 0, 500)
    // Dragging right moves the old target to the right of the center.
    expect(ndc(moved, 1, c.target)[0]).toBeGreaterThan(0.1)
    expect(ndc(moved, 1, c.target)[1]).toBeCloseTo(0)
  })

  it('zooms in and out, never past the minimum distance', () => {
    const c = frameBounds(bounds, 1)
    expect(dolly(c, 1, 0).distance).toBeLessThan(c.distance)
    expect(dolly(c, -1, 0).distance).toBeGreaterThan(c.distance)
    expect(dolly(c, 1000, 0.5).distance).toBe(0.5)
  })
})

describe('light projection', () => {
  it('fits the sphere in clip space, nearer points at smaller depth', () => {
    const m = lightProjection([0.3, -1, 0.2], [1, 2, 3], 2)
    const center = transformPoint(m, [1, 2, 3])
    expect(center[0]).toBeCloseTo(0)
    expect(center[1]).toBeCloseTo(0)
    expect(center[2]).toBeGreaterThan(0)
    expect(center[2]).toBeLessThan(1)
    // A point towards the light (up) is nearer.
    expect(transformPoint(m, [1, 3.9, 3])[2]).toBeLessThan(center[2])
    for (const p of [[3, 2, 3], [-1, 2, 3], [1, 2, 5], [1, 2, 1], [1, 4, 3], [1, 0, 3]] as Vec3[]) {
      const [x, y, z, w] = transformPoint(m, p)
      expect(w).toBeCloseTo(1)
      for (const v of [x, y]) expect(Math.abs(v)).toBeLessThanOrEqual(1.0001)
      expect(z).toBeGreaterThanOrEqual(0)
      expect(z).toBeLessThanOrEqual(1)
    }
  })

  it('works for a light straight down', () => {
    const [x, y, z] = transformPoint(lightProjection([0, -1, 0], [0, 0, 0], 1), [0, 0, 0])
    expect([x, y]).toEqual([expect.closeTo(0), expect.closeTo(0)])
    expect(z).toBeCloseTo(0.5)
  })
})
