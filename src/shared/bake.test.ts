import { describe, expect, it } from 'vitest'
import { BAKE_MAPS, DEFAULT_BAKE, DEFAULT_VIEW3D, normalizeBake, normalizeView3d } from './bake'
import { MAP_SLOTS } from './maps'

describe('bake settings', () => {
  it('defaults when nothing is saved', () => {
    expect(normalizeBake(undefined)).toEqual(DEFAULT_BAKE)
    expect(normalizeBake('x')).toEqual(DEFAULT_BAKE)
  })

  it('clamps numbers into range and rounds counts', () => {
    const s = normalizeBake({ size: 100000, aoSamples: 12.6, aoDistance: -1, edgeStrength: 'lots', padding: NaN })
    expect(s.size).toBe(2048)
    expect(s.aoSamples).toBe(13)
    expect(s.aoDistance).toBe(0.001)
    expect(s.edgeStrength).toBe(DEFAULT_BAKE.edgeStrength)
    expect(s.padding).toBe(DEFAULT_BAKE.padding)
  })

  it('keeps chosen maps and fills in maps added later', () => {
    const s = normalizeBake({ maps: { ao: false, thickness: true, bogus: true }, aoIgnoreBackfaces: true })
    expect(s.maps).toEqual({ ...DEFAULT_BAKE.maps, ao: false, thickness: true })
    expect(s.aoIgnoreBackfaces).toBe(true)
  })

  it('bakes only into existing map slots', () => {
    for (const m of BAKE_MAPS) expect(MAP_SLOTS.some((s) => s.id === m)).toBe(true)
  })
})

describe('3D view settings', () => {
  it('defaults to the full PSX look', () => {
    expect(normalizeView3d(null)).toEqual(DEFAULT_VIEW3D)
    expect(DEFAULT_VIEW3D).toMatchObject({ snap: true, affine: true, filter: false })
  })

  it('keeps valid values', () => {
    expect(normalizeView3d({ snap: false, resolution: 'full', dither: 'no' })).toEqual({ ...DEFAULT_VIEW3D, snap: false, resolution: 'full' })
    expect(normalizeView3d({ resolution: '720' }).resolution).toBe(DEFAULT_VIEW3D.resolution)
  })
})
