import { describe, expect, it } from 'vitest'
import { DEFAULT_DITHER, DITHER_PATTERNS, diffusionKernel, dither, ditherMixing, ditherPeriod, isDiffusion } from './dither'

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
    expect(ditherMixing({ ...DEFAULT_DITHER, twoNearest: true })).toBe('two-nearest')
    expect(ditherMixing({ ...DEFAULT_DITHER, twoNearest: true, mixing: 'knoll' })).toBe('knoll')
  })

  it('packs params to match the WGSL struct (16 scalars + 3 vec4f)', () => {
    const data = dither.pack!(DEFAULT_DITHER) as ArrayBuffer
    expect(data.byteLength).toBe(112)
  })
})
