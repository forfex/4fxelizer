import { describe, expect, it } from 'vitest'
import { analyzeStack, makesNewColors } from '@/stack/analyze'
import { BUILTIN_PRESETS } from '@/stack/builtinPresets'
import { DEFAULT_UPSCALE, upscaleSize } from './upscale'

describe('upscale', () => {
  it('multiplies the input or returns to the source size', () => {
    expect(upscaleSize({ width: 64, height: 32 }, DEFAULT_UPSCALE, null)).toEqual({ width: 256, height: 128 })
    expect(upscaleSize({ width: 64, height: 32 }, { ...DEFAULT_UPSCALE, sizeMode: 'source' }, { width: 500, height: 250 })).toEqual({
      width: 500,
      height: 250
    })
    expect(upscaleSize({ width: 4096, height: 4096 }, { ...DEFAULT_UPSCALE, factor: 16 }, null)).toEqual({ width: 8192, height: 8192 })
  })

  it('knows which filters keep the input colors', () => {
    const stage = (method: string) => ({ uid: 'u', passId: 'upscale', enabled: true, blend: { opacity: 1, mode: 'normal' as const }, params: { ...DEFAULT_UPSCALE, method } })
    expect(makesNewColors(stage('epx'))).toBe(false)
    expect(makesNewColors(stage('nearest'))).toBe(false)
    expect(makesNewColors(stage('n64'))).toBe(true)
  })

  it('N64 preset: 64 px texture, filtered back up ×4', () => {
    const doc = BUILTIN_PRESETS.find((p) => p.name === 'N64')!.build()
    const info = analyzeStack({ width: 1024, height: 1024 }, doc.stages, doc.palettes, doc.outputLock)
    expect(doc.stages.map((s) => info.get(s.uid)!.output.width)).toEqual([64, 64, 256, 256])
  })
})
