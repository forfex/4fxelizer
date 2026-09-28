import { describe, expect, it } from 'vitest'
import { DEFAULT_ADJUST } from '@/gpu/passes/adjust'
import { DEFAULT_DITHER } from '@/gpu/passes/dither'
import { DEFAULT_DOWNSCALE, downscaleSize } from '@/gpu/passes/downscale'
import { DEFAULT_QUANTIZE } from '@/gpu/passes/quantize'
import type { StageSpec } from '@/gpu/plan'
import type { Palette } from '@/palette/palette'
import { analyzeStack, type OutputLock } from './analyze'

const palette: Palette = { id: 'p', name: 'P', colors: [{ hex: '#000000' }, { hex: '#ffffff' }] }
const noLock: OutputLock = { enabled: false, paletteId: null }

function stage(passId: string, params: object = {}, extra: Partial<StageSpec> = {}): StageSpec {
  const defaults = { adjust: DEFAULT_ADJUST, downscale: DEFAULT_DOWNSCALE, quantize: DEFAULT_QUANTIZE, dither: DEFAULT_DITHER }
  return {
    uid: `${passId}-${Math.random()}`,
    passId,
    params: { ...defaults[passId as keyof typeof defaults], paletteId: 'p', ...params },
    enabled: true,
    blend: { opacity: 1, mode: 'normal' },
    ...extra
  }
}

const warningsOf = (stages: StageSpec[], lock = noLock, size = { width: 512, height: 512 }) =>
  stages.map((s) => analyzeStack(size, stages, [palette], lock).get(s.uid)!.warnings)

describe('downscaleSize', () => {
  it('keeps the aspect ratio for "longest side"', () => {
    expect(downscaleSize({ width: 1024, height: 512 }, { ...DEFAULT_DOWNSCALE, longest: 128 })).toEqual({ width: 128, height: 64 })
  })
  it('rounds to powers of two', () => {
    expect(downscaleSize({ width: 1000, height: 600 }, { ...DEFAULT_DOWNSCALE, longest: 128, pot: true })).toEqual({ width: 128, height: 64 })
  })
  it('supports exact and scale modes', () => {
    expect(downscaleSize({ width: 100, height: 100 }, { ...DEFAULT_DOWNSCALE, sizeMode: 'exact', width: 30, height: 7 })).toEqual({ width: 30, height: 7 })
    expect(downscaleSize({ width: 100, height: 50 }, { ...DEFAULT_DOWNSCALE, sizeMode: 'scale', scale: 0.25 })).toEqual({ width: 25, height: 13 })
  })
})

describe('analyzeStack', () => {
  it('tracks sizes through the stack', () => {
    const stages = [stage('adjust'), stage('downscale', { longest: 64 }), stage('dither')]
    const info = analyzeStack({ width: 256, height: 128 }, stages, [palette], noLock)
    expect(info.get(stages[2]!.uid)!.input).toEqual({ width: 64, height: 32 })
  })

  it('has no warnings for the default order', () => {
    expect(warningsOf([stage('adjust'), stage('downscale'), stage('quantize'), stage('dither', { mode: 'levels' })])).toEqual([[], [], [], []])
  })

  it('warns when a color-changing stage follows a palette snap', () => {
    const w = warningsOf([stage('quantize'), stage('adjust')])
    expect(w[1]![0]).toMatch(/Adjust after Quantize produces colors outside the palette/)
  })

  it('does not warn when a later snap or the output lock fixes it', () => {
    expect(warningsOf([stage('quantize'), stage('adjust'), stage('quantize')])[1]).toEqual([])
    expect(warningsOf([stage('quantize'), stage('adjust')], { enabled: true, paletteId: 'p' })[1]).toEqual([])
  })

  it('treats partial opacity as producing new colors', () => {
    const w = warningsOf([stage('quantize'), stage('dither', {}, { blend: { opacity: 0.5, mode: 'normal' } })])
    expect(w[1]!.some((m) => /outside the palette/.test(m))).toBe(true)
  })

  it('warns about pattern-only dither with nothing to snap after it', () => {
    expect(warningsOf([stage('dither', { mode: 'pattern' })])[0]!.some((m) => /Pattern only/.test(m))).toBe(true)
    expect(warningsOf([stage('dither', { mode: 'pattern' }), stage('quantize')])[0]).toEqual([])
  })

  it('warns about missing palettes and non-tiling patterns', () => {
    expect(warningsOf([stage('quantize', { paletteId: null })])[0]).toEqual(['Pick a palette.'])
    const w = warningsOf([stage('dither', { pattern: 'bayer8' })], noLock, { width: 100, height: 100 })
    expect(w[0]!.some((m) => /won't tile/.test(m))).toBe(true)
  })

  it('ignores disabled stages', () => {
    expect(warningsOf([stage('quantize'), stage('adjust', {}, { enabled: false })])[1]).toEqual([])
  })
})
