import { describe, expect, it } from 'vitest'
import { DEFAULT_ADJUST } from '@/gpu/passes/adjust'
import { DEFAULT_DITHER } from '@/gpu/passes/dither'
import { DEFAULT_DOWNSCALE } from '@/gpu/passes/downscale'
import { DEFAULT_QUANTIZE } from '@/gpu/passes/quantize'
import { DEFAULT_UPSCALE } from '@/gpu/passes/upscale'
import type { StageSpec } from '@/gpu/plan'
import { DEFAULT_GENERATOR, type Palette } from '@/palette/palette'
import { adjustMoreChanged, stageSummary } from './summary'

const DEFAULTS = { adjust: DEFAULT_ADJUST, downscale: DEFAULT_DOWNSCALE, upscale: DEFAULT_UPSCALE, quantize: DEFAULT_QUANTIZE, dither: DEFAULT_DITHER }

function stage(passId: keyof typeof DEFAULTS, params: object = {}): StageSpec {
  return { uid: passId, passId, params: { ...DEFAULTS[passId], ...params }, enabled: true, blend: { opacity: 1, mode: 'normal' } }
}

const generated: Palette = { id: 'gen', name: 'Dither (generated)', colors: [], ownerUid: 'dither', generator: { ...DEFAULT_GENERATOR, count: 16 } }
const project: Palette = { id: 'psx', name: 'PSX 16', colors: [{ hex: '#000000' }] }
const palettes = [generated, project]

describe('stageSummary', () => {
  it('says when Adjust changes nothing, else lists the changes', () => {
    expect(stageSummary(stage('adjust'), palettes)).toBe('No changes')
    expect(stageSummary(stage('adjust', { brightness: 0.1, hue: -20 }), palettes)).toBe('Brightness +0.1 · Hue −20°')
    expect(stageSummary(stage('adjust', { inWhite: 0.9, ao: 0.5 }), palettes)).toBe('Levels · AO')
    expect(stageSummary(stage('adjust', { brightness: 0.1, contrast: 0.2, gamma: 1.2, sharpen: 1 }), palettes)).toBe('Brightness +0.1 · Contrast +0.2 · 2 more')
  })

  it('gives Downscale its size and method', () => {
    expect(stageSummary(stage('downscale'), palettes)).toBe('128 px · Box / area')
    expect(stageSummary(stage('downscale', { sizeMode: 'exact', width: 64, height: 32, method: 'nearest', pot: true }), palettes)).toBe('64×32 · Nearest · POT')
    expect(stageSummary(stage('downscale', { sizeMode: 'scale', scale: 0.25 }), palettes)).toBe('25% · Box / area')
  })

  it('gives Upscale its factor and filter', () => {
    expect(stageSummary(stage('upscale', { factor: 4, method: 'nearest' }), palettes)).toBe('4× · Nearest')
    expect(stageSummary(stage('upscale', { sizeMode: 'source', method: 'nearest' }), palettes)).toBe('Original size · Nearest')
  })

  it('names where palette stages get their colors', () => {
    expect(stageSummary(stage('dither', { paletteId: 'gen' }), palettes)).toBe('Bayer 4×4 · 16 colors')
    expect(stageSummary(stage('dither', { paletteId: 'psx' }), palettes)).toBe('Bayer 4×4 · PSX 16')
    expect(stageSummary(stage('dither', { mode: 'levels', levels: 32 }), palettes)).toBe('Bayer 4×4 · 32 levels')
    expect(stageSummary(stage('dither', { mode: 'pattern' }), palettes)).toBe('Bayer 4×4 · Pattern only')
    expect(stageSummary(stage('quantize', { paletteId: 'missing' }), palettes)).toBe('No palette')
    expect(stageSummary(stage('quantize', { mode: 'levels', levels: 8 }), palettes)).toBe('8 levels')
  })
})

describe('adjustMoreChanged', () => {
  it('is set by levels, AO and cavity only', () => {
    expect(adjustMoreChanged(DEFAULT_ADJUST)).toBe(false)
    expect(adjustMoreChanged({ ...DEFAULT_ADJUST, brightness: 0.5 })).toBe(false)
    expect(adjustMoreChanged({ ...DEFAULT_ADJUST, outBlack: 0.1 })).toBe(true)
    expect(adjustMoreChanged({ ...DEFAULT_ADJUST, cavity: 0.2 })).toBe(true)
  })
})
