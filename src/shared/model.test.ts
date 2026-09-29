import { describe, expect, it } from 'vitest'
import { isModelFile, isModelResource, modelFormat, referenceCandidates } from './model'

describe('model files', () => {
  it('recognizes model extensions in any case', () => {
    expect(isModelFile('Hero.FBX')).toBe(true)
    expect(isModelFile('scene.glb')).toBe(true)
    expect(isModelFile('rock.png')).toBe(false)
    expect(modelFormat('a.gltf')).toBe('gltf')
    expect(modelFormat('a.GLB')).toBe('gltf')
    expect(modelFormat('a.obj')).toBe('obj')
    expect(modelFormat('a.blend')).toBeNull()
  })

  it('only allows buffers, material libraries and images as resources', () => {
    expect(isModelResource('mesh.bin')).toBe(true)
    expect(isModelResource('mesh.mtl')).toBe(true)
    expect(isModelResource('skin.TGA')).toBe(true)
    expect(isModelResource('secrets.txt')).toBe(false)
    expect(isModelResource('noext')).toBe(false)
  })
})

describe('referenceCandidates', () => {
  it('tries the path as written, then the name in the model folder and texture folders', () => {
    const c = referenceCandidates('tex/skin.png')
    expect(c[0]).toBe('tex/skin.png')
    expect(c[1]).toBe('skin.png')
    expect(c).toContain('textures/skin.png')
    expect(c).toContain('../textures/skin.png')
  })

  it('normalizes backslashes, URI escapes and file URLs', () => {
    expect(referenceCandidates('C:\\Users\\artist\\My%20Skin.png').slice(0, 2)).toEqual(['C:/Users/artist/My Skin.png', 'My Skin.png'])
    expect(referenceCandidates('file:///C:/art/a.png')[0]).toBe('C:/art/a.png')
    expect(referenceCandidates('file:///home/me/a.png')[0]).toBe('/home/me/a.png')
  })

  it('keeps names with a percent sign that is not an escape', () => {
    expect(referenceCandidates('100%.png')[0]).toBe('100%.png')
  })

  it('has nothing to read for embedded or remote references', () => {
    expect(referenceCandidates('data:image/png;base64,AAAA')).toEqual([])
    expect(referenceCandidates('blob:abc')).toEqual([])
    expect(referenceCandidates('https://example.com/a.png')).toEqual([])
    expect(referenceCandidates('  ')).toEqual([])
  })

  it('lists each path once', () => {
    const c = referenceCandidates('skin.png')
    expect(new Set(c).size).toBe(c.length)
  })
})
