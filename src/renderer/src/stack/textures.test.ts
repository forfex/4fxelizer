import { beforeEach, describe, expect, it } from 'vitest'
import { useApp } from '@/store'
import { initialDoc } from './doc'
import {
  activeMaterials,
  assignMaterials,
  changedDocKeys,
  closeTexture,
  docAt,
  docFor,
  setGenerated,
  docKeyOf,
  makeSeparate,
  makeShared,
  neighborOf,
  partTextures,
  SHARED,
  textureForDoc,
  type Docs,
  type TextureEntry
} from './textures'

const entry = (id: string): TextureEntry => ({
  id,
  image: { name: `${id}.png`, width: 4, height: 4, version: 1 },
  maps: {},
  thumbnail: null,
  materials: [],
  view: null
})

describe('texture documents', () => {
  const docs: Docs = { shared: initialDoc(), separate: {} }

  it('uses the shared stack unless a texture has its own', () => {
    expect(docKeyOf(docs, 'a')).toBe(SHARED)
    const split = makeSeparate(docs, 'a')
    expect(docKeyOf(split, 'a')).toBe('a')
    expect(docAt(split, 'a')).toEqual(docs.shared)
    expect(docAt(split, 'a')).not.toBe(docs.shared)
    expect(makeSeparate(split, 'a')).toBe(split)
    expect(docKeyOf(makeShared(split, 'a'), 'a')).toBe(SHARED)
  })

  it('finds what changed between two states', () => {
    const split = makeSeparate(docs, 'a')
    expect(changedDocKeys(docs, split)).toEqual(['a'])
    expect(changedDocKeys(split, { ...split, shared: initialDoc() })).toEqual([SHARED])
    expect(changedDocKeys(split, split)).toEqual([])
  })

  it('picks the texture that shows a change', () => {
    const textures = [entry('a'), entry('b'), entry('c')]
    const split = makeSeparate(docs, 'b')
    expect(textureForDoc(textures, split, SHARED, 'c')).toBe('c')
    expect(textureForDoc(textures, split, SHARED, 'b')).toBe('a')
    expect(textureForDoc(textures, split, 'b', 'a')).toBe('b')
    expect(textureForDoc(textures, split, 'gone', 'a')).toBeNull()
  })

  it('closes a texture with its separate stack and picks a neighbor', () => {
    const textures = [entry('a'), entry('b'), entry('c')]
    const closed = closeTexture(textures, makeSeparate(docs, 'b'), 'b')
    expect(closed.textures.map((t) => t.id)).toEqual(['a', 'c'])
    expect(closed.docs.separate).toEqual({})
    expect(neighborOf(textures, 'b')).toBe('c')
    expect(neighborOf(textures, 'c')).toBe('b')
    expect(neighborOf([entry('a')], 'a')).toBeNull()
  })
})

describe('model materials', () => {
  it('draws a material with one texture at a time', () => {
    let textures = assignMaterials([entry('a'), entry('b')], 'a', [0, 2])
    textures = assignMaterials(textures, 'b', [2, 1])
    expect(textures.map((t) => t.materials)).toEqual([[0], [1, 2]])
    expect(partTextures(3, textures, 'a', 0)).toEqual(['a', 'b', 'b'])
    expect(activeMaterials(3, textures, 'b', 0)).toEqual([1, 2])
  })

  it('shows an unbound active texture on the chosen texture set, and any texture on a one-material model', () => {
    const textures = [entry('a'), { ...entry('b'), materials: [1] }]
    expect(partTextures(3, textures, 'a', 2)).toEqual([null, 'b', 'a'])
    expect(partTextures(3, textures, 'b', 2)).toEqual([null, 'b', null])
    expect(activeMaterials(3, textures, 'a', 2)).toEqual([2])
    expect(partTextures(1, textures, 'b', 0)).toEqual(['b'])
    expect(activeMaterials(1, textures, 'b', 0)).toEqual([0])
  })
})

describe('generated palettes per texture', () => {
  const base = initialDoc()
  const generated = base.palettes.find((p) => p.generator)!
  const docs: Docs = { shared: base, separate: {} }
  const red = [{ hex: '#ff0000' }]
  const blue = [{ hex: '#0000ff' }]

  it('keeps colors per texture on the shared stack', () => {
    let d = setGenerated(docs, 'a', generated.id, red, 'ka', 'a')
    d = setGenerated(d, 'b', generated.id, blue, 'kb', 'a')
    const pa = docFor(d, 'a').palettes.find((p) => p.id === generated.id)!
    const pb = docFor(d, 'b').palettes.find((p) => p.id === generated.id)!
    expect([pa.colors, pa.generatedFor]).toEqual([red, 'ka'])
    expect([pb.colors, pb.generatedFor]).toEqual([blue, 'kb'])
    // The shared stack's own colors stay the active texture's.
    expect(d.shared.palettes.find((p) => p.id === generated.id)!.colors).toEqual(red)
    // Closing a texture drops its colors.
    const closed = closeTexture([entry('a'), entry('b')], d, 'b').docs
    expect(closed.shared.palettes.find((p) => p.id === generated.id)!.variants).toEqual({ a: { colors: red, generatedFor: 'ka' } })
  })

  it('uses one set of colors when generated from all textures, or on a separate stack', () => {
    const all: Docs = {
      shared: { ...base, palettes: base.palettes.map((p) => (p.id === generated.id ? { ...p, generator: { ...p.generator!, scope: 'all' as const } } : p)) },
      separate: {}
    }
    const d = setGenerated(all, null, generated.id, red, 'k', 'a')
    expect(docFor(d, 'a').palettes.find((p) => p.id === generated.id)!.colors).toEqual(red)
    expect(docFor(d, 'b').palettes.find((p) => p.id === generated.id)!.colors).toEqual(red)
    const split = setGenerated(makeSeparate(docs, 'a'), 'a', generated.id, blue, 'k', 'a')
    expect(split.separate.a!.palettes.find((p) => p.id === generated.id)!.variants).toBeUndefined()
    expect(docFor(split, 'a').palettes.find((p) => p.id === generated.id)!.colors).toEqual(blue)
    expect(docFor(split, 'b').palettes.find((p) => p.id === generated.id)!.colors).toEqual(generated.colors)
  })
})

describe('store with several textures', () => {
  const initial = useApp.getState()
  beforeEach(() => useApp.setState(initial, true))

  const add = (id: string): void => useApp.getState().addTexture({ id, image: { name: `${id}.png`, width: 8, height: 8 }, thumbnail: null })

  it('mirrors the active texture and keeps each one’s maps', () => {
    add('a')
    const map = { name: 'a_ao.png', width: 8, height: 8, channel: 'luma' as const, version: 1, thumbnail: null }
    useApp.getState().setMap('ao', map)
    add('b')
    expect(useApp.getState().activeTextureId).toBe('b')
    expect(useApp.getState().image?.name).toBe('b.png')
    expect(useApp.getState().maps).toEqual({})
    useApp.getState().selectTexture('a')
    expect(useApp.getState().maps.ao).toEqual(map)
    useApp.getState().setMap('cavity', map, 'b')
    expect(useApp.getState().maps.cavity).toBeUndefined()
    expect(useApp.getState().textures.find((t) => t.id === 'b')!.maps.cavity).toEqual(map)
  })

  it('edits the shared stack for every texture on it, and a separate one alone', () => {
    add('a')
    add('b')
    useApp.getState().addStage('adjust')
    const shared = useApp.getState().stages.length
    useApp.getState().selectTexture('a')
    expect(useApp.getState().stages.length).toBe(shared)

    useApp.getState().setTextureStack('a', 'separate')
    useApp.getState().addStage('adjust')
    expect(useApp.getState().stages.length).toBe(shared + 1)
    useApp.getState().selectTexture('b')
    expect(useApp.getState().stages.length).toBe(shared)
  })

  it('undoes across textures, showing the texture the change was made on', () => {
    add('a')
    add('b')
    useApp.getState().setTextureStack('b', 'separate')
    useApp.getState().addStage('adjust')
    const separateCount = useApp.getState().stages.length
    useApp.getState().selectTexture('a')
    const sharedCount = useApp.getState().stages.length

    useApp.getState().undo() // the stage added to b's stack
    expect(useApp.getState().activeTextureId).toBe('b')
    expect(useApp.getState().stages.length).toBe(separateCount - 1)
    useApp.getState().undo() // b back on the shared stack
    expect(useApp.getState().docs.separate).toEqual({})
    expect(useApp.getState().stages.length).toBe(sharedCount)
    useApp.getState().redo()
    useApp.getState().redo()
    expect(useApp.getState().activeTextureId).toBe('b')
    expect(useApp.getState().stages.length).toBe(separateCount)
  })

  it('closing the active texture shows its neighbor, closing the last shows none', () => {
    add('a')
    add('b')
    useApp.getState().closeTexture('b')
    expect(useApp.getState().activeTextureId).toBe('a')
    expect(useApp.getState().image?.name).toBe('a.png')
    useApp.getState().closeTexture('a')
    expect(useApp.getState().activeTextureId).toBeNull()
    expect(useApp.getState().image).toBeNull()
  })
})
