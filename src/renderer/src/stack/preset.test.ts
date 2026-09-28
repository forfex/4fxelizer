import { describe, expect, it } from 'vitest'
import type { DitherParams } from '@/gpu/passes/dither'
import type { DownscaleParams } from '@/gpu/passes/downscale'
import { analyzeStack } from './analyze'
import { BUILTIN_PRESETS } from './builtinPresets'
import { initialDoc, ownedPalette, toProjectPalette } from './doc'
import { parsePreset, presetFileName, PresetError, serializePreset } from './preset'

describe('presets', () => {
  it('round-trips a document with fresh ids and consistent references', () => {
    let doc = initialDoc()
    const project = { id: 'proj', name: 'Mine', colors: [{ hex: '#112233' }, { hex: '#445566', locked: true }] }
    doc = { ...doc, palettes: [...doc.palettes, project], outputLock: { enabled: true, paletteId: 'proj' } }
    const ditherUid = doc.stages[2]!.uid
    const { doc: loaded, name, warnings } = parsePreset(serializePreset(doc, 'My look'))

    expect(name).toBe('My look')
    expect(warnings).toEqual([])
    expect(loaded.stages.map((s) => s.passId)).toEqual(['adjust', 'downscale', 'dither'])
    expect(loaded.stages.every((s, i) => s.uid !== doc.stages[i]!.uid)).toBe(true)

    const dither = loaded.stages[2]!
    const owned = ownedPalette(loaded, dither.uid)!
    expect(owned).toBeDefined()
    expect(owned.generator!.from).toEqual({ kind: 'stage', uid: dither.uid })
    expect((dither.params as DitherParams).paletteId).toBe(owned.id)
    expect(ownedPalette(loaded, ditherUid)).toBeUndefined()

    const mine = loaded.palettes.find((p) => p.name === 'Mine')!
    expect(mine.colors).toEqual(project.colors)
    expect(loaded.outputLock).toEqual({ enabled: true, paletteId: mine.id })
  })

  it('saves auto-generated palettes without their colors, except locked ones', () => {
    const doc = initialDoc()
    const owned = doc.palettes[0]!
    owned.colors = [{ hex: '#000000' }, { hex: '#ffffff', locked: true }]
    const json = JSON.parse(serializePreset(doc, 'x'))
    expect(json.palettes[0].colors).toEqual([{ hex: '#ffffff', locked: true }])
  })

  it('fills in missing settings and drops unknown ones', () => {
    const json = JSON.stringify({
      format: '4fxelizer-preset',
      version: 1,
      name: 'old',
      stages: [
        { uid: 'a', passId: 'downscale', params: { longest: 64, bogus: 1, method: 5 }, blend: { opacity: 7, mode: 'nope' } },
        { uid: 'b', passId: 'sparkles', params: {} }
      ],
      palettes: [{ id: 'p', name: 'P', colors: ['#ABC', 'zzz', { hex: '#010203' }] }]
    })
    const { doc, warnings } = parsePreset(json)
    expect(doc.stages).toHaveLength(1)
    const params = doc.stages[0]!.params as DownscaleParams & { bogus?: number }
    expect(params.longest).toBe(64)
    expect(params.method).toBe('box')
    expect(params.bogus).toBeUndefined()
    expect(doc.stages[0]!.blend).toEqual({ opacity: 1, mode: 'normal' })
    expect(doc.palettes[0]!.colors).toEqual([{ hex: '#aabbcc' }, { hex: '#010203' }])
    expect(warnings[0]).toMatch(/sparkles/)
  })

  it('writes only the document, even when given the whole app state', () => {
    const state = { ...initialDoc(), past: [1, 2, 3], image: { name: 'x' }, setView: () => {} }
    expect(Object.keys(JSON.parse(serializePreset(state, 'x'))).sort()).toEqual(
      ['format', 'name', 'outputLock', 'palettes', 'stages', 'version']
    )
  })

  it('rejects files that are not presets', () => {
    expect(() => parsePreset('not json')).toThrow(PresetError)
    expect(() => parsePreset('{"format":"other"}')).toThrow(PresetError)
    expect(() => parsePreset('{"format":"4fxelizer-preset","version":99}')).toThrow(/newer version/)
  })

  it('makes safe file names', () => {
    expect(presetFileName('PSX: 8bpp / test?')).toBe('PSX_ 8bpp _ test_.4fxpreset')
    expect(presetFileName('  ...  ')).toBe('preset.4fxpreset')
  })

  it('switching a stage to a project palette survives a round trip', () => {
    let doc = initialDoc()
    doc = { ...doc, palettes: [...doc.palettes, { id: 'proj', name: 'P', colors: [{ hex: '#000000' }] }] }
    doc = { ...doc, ...toProjectPalette(doc, doc.stages[2]!.uid, 'proj') }
    const { doc: loaded } = parsePreset(serializePreset(doc, 'x'))
    expect((loaded.stages[2]!.params as DitherParams).paletteId).toBe(loaded.palettes[0]!.id)
  })

  for (const preset of BUILTIN_PRESETS) {
    it(`built-in "${preset.name}" is valid and has no order warnings`, () => {
      const doc = preset.build()
      const info = analyzeStack({ width: 512, height: 512 }, doc.stages, doc.palettes, doc.outputLock)
      const warnings = [...info.values()].flatMap((i) => i.warnings).filter((w) => !/no colors yet/.test(w))
      expect(warnings).toEqual([])
      expect(parsePreset(serializePreset(doc, preset.name)).warnings).toEqual([])
    })
  }
})
