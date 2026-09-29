import { describe, expect, it } from 'vitest'
import type { DitherParams } from '@/gpu/passes/dither'
import { initialDoc, ownedPalette } from './doc'
import { base64ToBytes, bytesToBase64, parseProject, projectSignature, ProjectError, serializeProject, type ProjectData, type ProjectState } from './project'

function sample(): ProjectData {
  const doc = initialDoc()
  doc.palettes[0]!.colors = [{ hex: '#102030' }, { hex: '#405060', locked: true }]
  doc.palettes[0]!.generatedFor = 'key'
  return {
    doc,
    presetName: 'PSX 8bpp',
    texture: { name: 'wall.png', file: { path: 'C:/art/wall.png', relative: 'wall.png' } },
    maps: [
      { slot: 'ao', channel: 'r', name: 'wall_orm.png', file: { path: 'C:/art/wall_orm.png', relative: 'wall_orm.png' } },
      { slot: 'cavity', channel: 'luma', name: 'Baked cavity', baked: true, png: 'iVBORw0KGgo=' }
    ],
    model: { name: 'castle.glb', file: { path: 'C:/art/castle.glb' }, material: 2, uvSet: 1 }
  }
}

describe('projects', () => {
  it('round-trips the document, files, maps and model', () => {
    const data = sample()
    const { project, warnings } = parseProject(serializeProject(data))
    expect(warnings).toEqual([])
    expect(project.texture).toEqual(data.texture)
    expect(project.maps).toEqual(data.maps)
    expect(project.model).toEqual(data.model)
    expect(project.presetName).toBe('PSX 8bpp')
    expect(project.doc.stages.map((s) => s.passId)).toEqual(data.doc.stages.map((s) => s.passId))
    // Every color is kept (also of generated palettes), but not the generation key.
    const dither = project.doc.stages[2]!
    const owned = ownedPalette(project.doc, dither.uid)!
    expect(owned.colors).toEqual(data.doc.palettes[0]!.colors)
    expect(owned.generatedFor).toBeUndefined()
    expect((dither.params as DitherParams).paletteId).toBe(owned.id)
  })

  it('keeps an embedded texture and drops broken entries with a warning', () => {
    const json = JSON.stringify({
      format: '4fxelizer-project',
      version: 1,
      doc: {},
      texture: { name: 'tex.png', png: 'AAAA' },
      maps: [{ slot: 'ao', file: { path: 'x.png' } }, { slot: 'ao', file: { path: 'y.png' } }, { slot: 'bogus', file: { path: 'z' } }, { slot: 'edge' }],
      model: { name: 'm.obj' }
    })
    const { project, warnings } = parseProject(json)
    expect(project.texture).toEqual({ name: 'tex.png', png: 'AAAA' })
    expect(project.maps).toEqual([{ slot: 'ao', channel: 'luma', name: 'ao', file: { path: 'x.png' } }])
    expect(project.model).toBeNull()
    expect(warnings).toHaveLength(2)
  })

  it('rejects files that are not projects', () => {
    expect(() => parseProject('nope')).toThrow(ProjectError)
    expect(() => parseProject('{"format":"4fxelizer-preset"}')).toThrow(ProjectError)
    expect(() => parseProject('{"format":"4fxelizer-project","version":99}')).toThrow(/newer version/)
  })

  it('signature ignores regenerated colors but not edits, files or maps', () => {
    const doc = initialDoc()
    const state: ProjectState = {
      ...doc,
      image: { name: 'wall.png', path: 'C:/wall.png', version: 1 },
      maps: { ao: { name: 'Baked AO', channel: 'luma', baked: true, version: 3 } },
      model: null,
      modelMaterial: 0,
      modelUvSet: 0
    }
    const base = projectSignature(state)
    const regenerated = doc.palettes.map((p) => ({ ...p, colors: [{ hex: '#abcdef' }], generatedFor: 'k' }))
    expect(projectSignature({ ...state, palettes: regenerated })).toBe(base)
    expect(projectSignature({ ...state, image: { ...state.image!, version: 2 } })).toBe(base) // reloaded from its file
    expect(projectSignature({ ...state, stages: doc.stages.slice(1) })).not.toBe(base)
    expect(projectSignature({ ...state, maps: { ao: { ...state.maps.ao!, version: 4 } } })).not.toBe(base)
    expect(projectSignature({ ...state, image: { name: 'x.png', path: 'C:/x.png', version: 1 } })).not.toBe(base)
  })

  it('encodes bytes as base64 and back', () => {
    const bytes = new Uint8Array(100_000).map((_, i) => (i * 31) & 255)
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })
})
