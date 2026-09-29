import { describe, expect, it } from 'vitest'
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial } from 'three'
import { flattenScene } from './flatten'
import { parseModel } from './load'
import { objMaterialLibraries, parseMtl } from './mtl'

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

const OBJ = `mtllib shop.mtl
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
vt 0 0
vt 1 0
vt 1 1
vt 0 1
vn 0 0 1
usemtl Wood
f 1/1/1 2/2/1 3/3/1
usemtl Metal
f 1/1/1 3/3/1 4/4/1
usemtl Wood
f 2/2/1 3/3/1 4/4/1
`

const MTL = `newmtl Wood
Kd 0.5 0.25 0
map_Kd -s 2 2 1 -bm 0.5 tex/wood planks.png
newmtl Metal
Kd 1 1 1
`

describe('parseModel (OBJ)', () => {
  it('groups triangles by material and takes colors and textures from the material library', async () => {
    const m = await parseModel({ name: 'shop.obj', bytes: enc(OBJ), resources: { 'shop.mtl': enc(MTL) } })
    expect(m.format).toBe('obj')
    expect(m.materials.map((x) => x.name)).toEqual(['Wood', 'Metal'])
    expect(m.parts).toEqual([{ first: 0, count: 2 }, { first: 2, count: 1 }])
    expect(m.materials[0]!.texture).toEqual({ kind: 'file', reference: 'tex/wood planks.png' })
    expect(m.materials[0]!.color[0]).toBeCloseTo(0.5)
    expect(m.materials[1]!.texture).toBeNull()
    expect(m.bounds).toEqual({ min: [0, 0, 0], max: [1, 1, 0] })
  })

  it('flips v so it points down the image', async () => {
    const m = await parseModel({ name: 'shop.obj', bytes: enc(OBJ), resources: {} })
    const uv = m.uvSets[0]!
    // The vertex at uv (0, 0) (bottom left in OBJ) samples the image's bottom row: v = 1.
    const i = m.indices[0]!
    expect([uv[i * 2], uv[i * 2 + 1]]).toEqual([0, 1])
  })

  it('rejects files it can’t read', async () => {
    await expect(parseModel({ name: 'a.blend', bytes: enc(''), resources: {} })).rejects.toThrow(/isn’t a model/)
  })
})

describe('flattenScene', () => {
  const opts = { name: 'x', format: 'gltf' as const, flipV: false, textureOf: () => null }

  it('bakes transforms into world space', () => {
    const mesh = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial())
    mesh.position.set(10, 0, 0)
    const group = new Group()
    group.scale.set(2, 2, 2)
    group.add(mesh)
    const m = flattenScene(group, opts)
    expect(m.bounds.min).toEqual([18, -2, -2])
    expect(m.bounds.max).toEqual([22, 2, 2])
    expect(m.indices.length / 3).toBe(12)
    expect(m.uvSets.length).toBe(1)
  })

  it('keeps triangles facing out under a mirrored transform', () => {
    const faceNormalZ = (m: ReturnType<typeof flattenScene>): number => {
      const [a, b, c] = [m.indices[0]!, m.indices[1]!, m.indices[2]!].map((i) => [m.positions[i * 3]!, m.positions[i * 3 + 1]!, m.positions[i * 3 + 2]!])
      const e1 = [b![0]! - a![0]!, b![1]! - a![1]!]
      const e2 = [c![0]! - a![0]!, c![1]! - a![1]!]
      return e1[0]! * e2[1]! - e1[1]! * e2[0]!
    }
    // One counter-clockwise triangle facing +z.
    const plane = (): Mesh => {
      const g = new BufferGeometry()
      g.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
      return new Mesh(g, new MeshBasicMaterial())
    }
    const plain = flattenScene(plane(), opts)
    const mirroredMesh = plane()
    mirroredMesh.scale.set(-1, 1, 1)
    const mirrored = flattenScene(mirroredMesh, opts)
    expect(Math.sign(faceNormalZ(plain))).toBe(1)
    expect(Math.sign(faceNormalZ(mirrored))).toBe(1)
  })

  it('splits multi-material meshes by their groups', () => {
    const box = new BoxGeometry(1, 1, 1) // 6 groups, material index 0–5
    const materials = [0, 1, 2, 3, 4, 5].map((i) => new MeshBasicMaterial({ name: i % 2 ? 'odd' : 'even' }))
    const m = flattenScene(new Mesh(box, materials), opts)
    expect(m.materials.map((x) => x.name)).toEqual(['even', 'odd'])
    expect(m.parts).toEqual([{ first: 0, count: 6 }, { first: 6, count: 6 }])
  })

  it('warns when there are no UVs', () => {
    const box = new BoxGeometry(1, 1, 1)
    box.deleteAttribute('uv')
    const m = flattenScene(new Mesh(box, new MeshBasicMaterial()), opts)
    expect(m.uvSets).toEqual([])
    expect(m.warnings.join()).toMatch(/no UVs/)
  })

  it('refuses an empty scene', () => {
    expect(() => flattenScene(new Group(), opts)).toThrow(/no meshes/)
  })
})

describe('material libraries', () => {
  it('reads colors and texture names, skipping map options', () => {
    const lib = parseMtl(MTL)
    expect(lib.get('Wood')).toEqual({ color: [0.5, 0.25, 0], map: 'tex/wood planks.png' })
    expect(lib.get('Metal')).toEqual({ color: [1, 1, 1], map: null })
    expect(parseMtl('newmtl A\nmap_Kd -clamp on -o 0.5 a.tga').get('A')!.map).toBe('a.tga')
  })

  it('finds the libraries an OBJ uses', () => {
    expect(objMaterialLibraries('# x\nmtllib a.mtl\nv 0 0 0\nmtllib  b.mtl c.mtl \n')).toEqual(['a.mtl', 'b.mtl', 'c.mtl'])
    expect(objMaterialLibraries('mtllib my shop.mtl\n')).toEqual(['my shop.mtl'])
  })
})
