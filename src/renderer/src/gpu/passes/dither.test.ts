import { describe, expect, it } from 'vitest'
import { DEFAULT_DITHER, DITHER_PATTERNS, diffusionKernel, dither, ditherMask, ditherMixing, ditherPeriod, ditherTiles, isDiffusion, outsidePattern } from './dither'

describe('dither', () => {
  it('keeps the original patterns at their shader indices', () => {
    expect(DITHER_PATTERNS.slice(0, 5).map((d) => d.id)).toEqual(['bayer2', 'bayer4', 'bayer8', 'bayer16', 'blue-noise'])
  })

  it('has normalized diffusion kernels (Atkinson spreads 3/4 of the error)', () => {
    for (const d of DITHER_PATTERNS) {
      const sum = diffusionKernel(d.id).reduce((a, b) => a + b, 0)
      if (d.kind === 'ordered') expect(sum).toBe(0)
      else expect(sum).toBeCloseTo(d.id === 'atkinson' ? 0.75 : 1, 6)
    }
  })

  it('runs diffusion serially, except when showing the mask or in pattern mode', () => {
    const fs = { ...DEFAULT_DITHER, pattern: 'floyd-steinberg' as const }
    expect(isDiffusion('floyd-steinberg')).toBe(true)
    expect(dither.serial!(fs)).toBe(true)
    expect(dither.serial!({ ...fs, showMask: true })).toBe(false)
    expect(dither.serial!({ ...fs, mode: 'pattern' })).toBe(false)
    expect(dither.serial!(DEFAULT_DITHER)).toBe(false)
  })

  it('reports periods (0 = never repeats) and honors the legacy two-nearest switch', () => {
    expect(ditherPeriod({ ...DEFAULT_DITHER, pattern: 'bayer8', scale: 2 })).toBe(16)
    expect(ditherPeriod({ ...DEFAULT_DITHER, pattern: 'white-noise' })).toBe(0)
    expect(ditherPeriod({ ...DEFAULT_DITHER, pattern: 'atkinson', scale: 3 })).toBe(0)
    expect(ditherPeriod({ ...DEFAULT_DITHER, pattern: 'checker' })).toBe(2)
    expect(ditherPeriod({ ...DEFAULT_DITHER, pattern: 'crosshatch', scale: 2 })).toBe(16)
    expect(ditherMixing({ ...DEFAULT_DITHER, twoNearest: true })).toBe('two-nearest')
    expect(ditherMixing({ ...DEFAULT_DITHER, twoNearest: true, mixing: 'knoll' })).toBe('knoll')
  })

  it('tiles: ordered when the period divides the size, diffusion only with wrap-around', () => {
    const size = { width: 72, height: 64 }
    expect(ditherTiles({ ...DEFAULT_DITHER, pattern: 'bayer8' }, size)).toBe(true)
    expect(ditherTiles({ ...DEFAULT_DITHER, pattern: 'bayer16' }, size)).toBe(false)
    expect(ditherTiles({ ...DEFAULT_DITHER, pattern: 'ign' }, size)).toBe(false)
    expect(ditherTiles({ ...DEFAULT_DITHER, pattern: 'jarvis' }, size)).toBe(false)
    expect(ditherTiles({ ...DEFAULT_DITHER, pattern: 'jarvis', wrap: true }, { width: 7, height: 5 })).toBe(true)
  })

  it('packs params to match the WGSL struct (20 scalars + 6 vec4f)', () => {
    const data = dither.pack!(DEFAULT_DITHER) as ArrayBuffer
    expect(data.byteLength).toBe(176)
  })

  it('builds a mask from one or two sources, and reads the maps they use', () => {
    expect(ditherMask(DEFAULT_DITHER)).toBeNull()
    expect(dither.mask!(DEFAULT_DITHER)).toBeNull()
    const second = { ...DEFAULT_DITHER, mask2: 'map-ao' as const, mask2Invert: true, maskBlur: 3 }
    expect(ditherMask(second)).toMatchObject({ a: 'map-ao', aInvert: true, b: 'none', blur: 3 })
    const both = { ...second, mask: 'edges' as const, maskCombine: 'max' as const }
    expect(ditherMask(both)).toMatchObject({ a: 'edges', b: 'map-ao', bInvert: true, combine: 'max' })
    expect(dither.resources!(both).maps).toEqual(['ao'])
  })

  it('uses the outside pattern only with a mask, and runs serially when it diffuses', () => {
    const outside = { ...DEFAULT_DITHER, outsidePattern: 'atkinson' as const }
    expect(outsidePattern(outside)).toBeNull()
    expect(dither.serial!(outside)).toBe(false)
    const masked = { ...outside, mask: 'shadows' as const }
    expect(outsidePattern(masked)).toBe('atkinson')
    expect(dither.serial!(masked)).toBe(true)
  })
})
