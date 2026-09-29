// Built-in shapes the 3D view shows the texture on when no model is open: cube, plane, sphere
// (once or twice tiled) and torus, as ModelData (counter-clockwise, outward normals, v down the
// image like loaded models).

import type { View3dShape } from '@shared/view3d'
import type { ModelData } from './model'

type Vec3 = [number, number, number]

/** Builds a (u, v) grid of `cols` × `rows` quads; `at(u, v)` gives the point and normal at 0–1 coordinates. */
class Builder {
  readonly positions: number[] = []
  readonly normals: number[] = []
  readonly uvs: number[] = []
  readonly indices: number[] = []

  grid(cols: number, rows: number, at: (u: number, v: number) => { p: Vec3; n: Vec3 }, uvScale: [number, number] = [1, 1]): void {
    const base = this.positions.length / 3
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) {
        const u = i / cols
        const v = j / rows
        const { p, n } = at(u, v)
        this.positions.push(...p)
        this.normals.push(...n)
        this.uvs.push(u * uvScale[0], v * uvScale[1])
      }
    }
    const index = (i: number, j: number): number => base + j * (cols + 1) + i
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        // u runs right, v runs down the image; `at` puts the outside on the side where this winds counter-clockwise.
        const a = index(i, j)
        const b = index(i + 1, j)
        const c = index(i + 1, j + 1)
        const d = index(i, j + 1)
        this.indices.push(a, d, c, a, c, b)
      }
    }
  }

  build(name: string): ModelData {
    const positions = new Float32Array(this.positions)
    const min: Vec3 = [Infinity, Infinity, Infinity]
    const max: Vec3 = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < positions.length; i++) {
      min[i % 3] = Math.min(min[i % 3]!, positions[i]!)
      max[i % 3] = Math.max(max[i % 3]!, positions[i]!)
    }
    const indices = new Uint32Array(this.indices)
    return {
      name,
      format: 'shape',
      positions,
      normals: new Float32Array(this.normals),
      uvSets: [new Float32Array(this.uvs)],
      indices,
      parts: [{ first: 0, count: indices.length / 3 }],
      materials: [{ name, color: [0.8, 0.8, 0.8], texture: null }],
      bounds: { min, max },
      warnings: []
    }
  }
}

/** A face of the cube: its outward normal and the directions u and v run along (seen from outside). */
const CUBE_FACES: { n: Vec3; u: Vec3; v: Vec3 }[] = [
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, -1, 0] },
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, -1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, -1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, -1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, -1] }
]

function sphere(b: Builder, uvScale: [number, number]): void {
  b.grid(
    48,
    24,
    (u, v) => {
      const theta = u * Math.PI * 2
      const phi = v * Math.PI
      const n: Vec3 = [Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta)]
      return { p: n, n }
    },
    uvScale
  )
}

export function shapeModel(shape: View3dShape): ModelData {
  const b = new Builder()
  switch (shape) {
    case 'cube':
      for (const f of CUBE_FACES) {
        b.grid(1, 1, (u, v) => ({
          p: [0, 1, 2].map((a) => f.n[a]! + f.u[a]! * (u * 2 - 1) + f.v[a]! * (v * 2 - 1)) as Vec3,
          n: f.n
        }))
      }
      break
    case 'plane':
      b.grid(1, 1, (u, v) => ({ p: [u * 2 - 1, 0, v * 2 - 1], n: [0, 1, 0] }))
      break
    case 'sphere':
      sphere(b, [1, 1])
      break
    case 'sphere-tiled':
      sphere(b, [2, 2])
      break
    case 'torus': {
      const R = 1
      const r = 0.4
      b.grid(
        64,
        24,
        (u, v) => {
          const theta = u * Math.PI * 2
          // v = 0 on the outside, then down and around under the ring (so the grid winds outward).
          const phi = -v * Math.PI * 2
          const n: Vec3 = [Math.cos(phi) * Math.sin(theta), Math.sin(phi), Math.cos(phi) * Math.cos(theta)]
          return { p: [(R + r * Math.cos(phi)) * Math.sin(theta), r * Math.sin(phi), (R + r * Math.cos(phi)) * Math.cos(theta)], n }
        },
        [3, 1]
      )
      break
    }
  }
  return b.build(shape)
}
