// Turns a three.js scene (as the glTF/FBX/OBJ loaders build it) into one flat, world-space mesh
// with its triangles grouped by material.

import { Color, Matrix3, Mesh, SRGBColorSpace, Vector3, type BufferAttribute, type BufferGeometry, type InterleavedBufferAttribute, type Material, type Object3D } from 'three'
import type { ModelFormat } from '@shared/model'
import type { ModelData, ModelMaterial, TextureRef } from './model'

/** UV attribute names three.js uses for the first, second, … UV set. */
const UV_NAMES = ['uv', 'uv1', 'uv2', 'uv3']

type Attribute = BufferAttribute | InterleavedBufferAttribute

export interface FlattenOptions {
  name: string
  format: ModelFormat
  /** The file's UVs have v pointing up the image (OBJ, FBX); they are flipped to point down. */
  flipV: boolean
  /** The base color texture of a material, if it has one. */
  textureOf(material: Material): TextureRef | null
}

interface MeshEntry {
  mesh: Mesh
  geometry: BufferGeometry
}

function meshesOf(root: Object3D): MeshEntry[] {
  root.updateMatrixWorld(true)
  const out: MeshEntry[] = []
  root.traverse((o) => {
    if (!(o instanceof Mesh) || !o.geometry?.attributes.position) return
    let geometry = o.geometry as BufferGeometry
    if (!geometry.attributes.normal) {
      geometry = geometry.clone()
      geometry.computeVertexNormals()
    }
    out.push({ mesh: o, geometry })
  })
  return out
}

function srgbColor(material: Material): [number, number, number] {
  const color = (material as Material & { color?: Color }).color
  if (!(color instanceof Color)) return [0.8, 0.8, 0.8]
  const c = { r: 0, g: 0, b: 0 }
  color.getRGB(c, SRGBColorSpace)
  return [c.r, c.g, c.b]
}

/** The scene's meshes as one mesh in world space, triangles grouped by material. */
export function flattenScene(root: Object3D, opts: FlattenOptions): ModelData {
  const entries = meshesOf(root)
  const warnings: string[] = []

  // Materials, merged by name (loaders may create one per mesh for the same material).
  const materials: ModelMaterial[] = []
  const materialIndex = new Map<Material | string, number>()
  const indexOf = (material: Material | undefined): number => {
    const key: Material | string = material ? material.name || material : '(default)'
    let i = materialIndex.get(key)
    if (i === undefined) {
      i = materials.length
      materialIndex.set(key, i)
      materials.push({
        name: material?.name || `Material ${i + 1}`,
        color: material ? srgbColor(material) : [0.8, 0.8, 0.8],
        texture: material ? opts.textureOf(material) : null
      })
    } else if (material && !materials[i]!.texture) {
      materials[i]!.texture = opts.textureOf(material)
    }
    return i
  }

  const uvSetCount = entries.reduce((n, { geometry }) => {
    let k = 0
    while (k < UV_NAMES.length && geometry.attributes[UV_NAMES[k]!]) k++
    return Math.max(n, k)
  }, 0)
  const vertexTotal = entries.reduce((n, e) => n + e.geometry.attributes.position!.count, 0)
  const positions = new Float32Array(vertexTotal * 3)
  const normals = new Float32Array(vertexTotal * 3)
  const uvSets = Array.from({ length: uvSetCount }, () => new Float32Array(vertexTotal * 2))
  /** Triangles (3 global vertex indices each) per material. */
  const byMaterial: number[][] = []
  let missingUvs = false

  const p = new Vector3()
  const n = new Vector3()
  const normalMatrix = new Matrix3()
  let base = 0
  for (const { mesh, geometry } of entries) {
    const pos = geometry.attributes.position as Attribute
    const nrm = geometry.attributes.normal as Attribute
    const count = pos.count
    normalMatrix.getNormalMatrix(mesh.matrixWorld)
    for (let i = 0; i < count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
      positions.set([p.x, p.y, p.z], (base + i) * 3)
      n.fromBufferAttribute(nrm, i).applyMatrix3(normalMatrix).normalize()
      normals.set([n.x, n.y, n.z], (base + i) * 3)
    }
    for (let s = 0; s < uvSetCount; s++) {
      const uv = geometry.attributes[UV_NAMES[s]!] as Attribute | undefined
      if (!uv) {
        missingUvs = true
        continue
      }
      const out = uvSets[s]!
      for (let i = 0; i < count; i++) {
        const v = uv.getY(i)
        out[(base + i) * 2] = uv.getX(i)
        out[(base + i) * 2 + 1] = opts.flipV ? 1 - v : v
      }
    }

    // Mirrored transforms turn triangles inside out; swap the winding back.
    const mirrored = mesh.matrixWorld.determinant() < 0
    const index = geometry.index
    const vertexAt = (k: number): number => base + (index ? index.getX(k) : k)
    const pushRange = (start: number, end: number, material: Material | undefined): void => {
      const list = (byMaterial[indexOf(material)] ??= [])
      for (let k = start; k + 2 < end; k += 3) {
        const a = vertexAt(k)
        const b = vertexAt(k + 1)
        const c = vertexAt(k + 2)
        if (mirrored) list.push(a, c, b)
        else list.push(a, b, c)
      }
    }
    const elementCount = index ? index.count : count
    const material = mesh.material as Material | Material[]
    if (Array.isArray(material) && geometry.groups.length) {
      for (const g of geometry.groups) {
        pushRange(g.start, Math.min(g.start + g.count, elementCount), material[g.materialIndex ?? 0])
      }
    } else {
      pushRange(0, elementCount, Array.isArray(material) ? material[0] : material)
    }
    base += count
  }

  if (!uvSetCount) warnings.push('The model has no UVs, so textures and baked maps can’t be placed on it.')
  else if (missingUvs) warnings.push('Some parts of the model have no UVs.')

  const parts: ModelData['parts'] = []
  const all: number[] = []
  for (let m = 0; m < materials.length; m++) {
    const list = byMaterial[m] ?? []
    parts.push({ first: all.length / 3, count: list.length / 3 })
    for (const v of list) all.push(v)
  }

  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a]!, positions[i + a]!)
      max[a] = Math.max(max[a]!, positions[i + a]!)
    }
  }
  if (!vertexTotal) throw new Error('The file has no meshes.')

  return {
    name: opts.name,
    format: opts.format,
    positions,
    normals,
    uvSets,
    indices: new Uint32Array(all),
    parts,
    materials,
    bounds: { min, max },
    warnings
  }
}
