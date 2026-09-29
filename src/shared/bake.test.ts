import { describe, expect, it } from 'vitest'
import { BAKE_MAPS, BUILTIN_BAKE_PRESETS, DEFAULT_BAKE, MAX_BAKE_PRESETS, normalizeBake, normalizeBakePresets, sameBake } from './bake'
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

describe('bake presets', () => {
  it('has distinct, valid built-in presets', () => {
    for (const p of BUILTIN_BAKE_PRESETS) expect(normalizeBake(p.settings)).toEqual(p.settings)
    for (const [i, a] of BUILTIN_BAKE_PRESETS.entries()) {
      for (const b of BUILTIN_BAKE_PRESETS.slice(i + 1)) expect(sameBake(a.settings, b.settings)).toBe(false)
    }
    expect(BUILTIN_BAKE_PRESETS.some((p) => sameBake(p.settings, DEFAULT_BAKE))).toBe(true)
  })

  it('compares settings field by field', () => {
    expect(sameBake(DEFAULT_BAKE, normalizeBake({}))).toBe(true)
    expect(sameBake(DEFAULT_BAKE, { ...DEFAULT_BAKE, aoSamples: 3 })).toBe(false)
    expect(sameBake(DEFAULT_BAKE, { ...DEFAULT_BAKE, maps: { ...DEFAULT_BAKE.maps, up: true } })).toBe(false)
  })

  it('keeps saved presets valid, one per name', () => {
    const presets = normalizeBakePresets([
      { name: ' Mine ', settings: { size: 512 } },
      { name: '', settings: {} },
      { name: 'x' },
      'junk',
      { name: 'Mine', settings: { size: 256, aoSamples: 1e9 } }
    ])
    expect(presets).toHaveLength(1)
    expect(presets[0]!.name).toBe('Mine')
    expect(presets[0]!.settings.size).toBe(256)
    expect(presets[0]!.settings.aoSamples).toBe(1024)
    expect(normalizeBakePresets('nope')).toEqual([])
    const many = Array.from({ length: MAX_BAKE_PRESETS + 5 }, (_, i) => ({ name: `p${i}`, settings: {} }))
    expect(normalizeBakePresets(many)[0]!.name).toBe('p5')
  })
})
