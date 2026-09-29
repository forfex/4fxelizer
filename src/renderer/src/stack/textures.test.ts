import { beforeEach, describe, expect, it } from 'vitest'
import { useApp } from '@/store'
import { initialDoc } from './doc'
import {
  changedDocKeys,
  closeTexture,
  docAt,
  docKeyOf,
  makeSeparate,
  makeShared,
  neighborOf,
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
