import { describe, expect, it } from 'vitest'
import type { DitherParams } from '@/gpu/passes/dither'
import { initialDoc, ownedPalette } from './doc'
import { base64ToBytes, bytesToBase64, parseProject, projectSignature, ProjectError, serializeProject, type ProjectData, type ProjectState } from './project'

function sample(): ProjectData {
  const doc = initialDoc()
  doc.palettes[0]!.colors = [{ hex: '#102030' }, { hex: '#405060', locked: true }]
  doc.palettes[0]!.generatedFor = 'key'
  const separate = initialDoc()
  separate.stages = separate.stages.slice(0, 1)
  return {
    doc,
    presetName: 'PSX 8bpp',
    textures: [
      {
        name: 'wall.png',
        file: { path: 'C:/art/wall.png', relative: 'wall.png' },
        maps: [
          { slot: 'ao', channel: 'r', name: 'wall_orm.png', file: { path: 'C:/art/wall_orm.png', relative: 'wall_orm.png' } },
          { slot: 'cavity', channel: 'luma', name: 'Baked cavity', baked: true, png: 'iVBORw0KGgo=' }
        ],
        materials: [0, 2]
      },
      { name: 'roof.png', png: 'iVBORw0KGgo=', maps: [], doc: separate, materials: [1] }
    ],
    active: 1,
    model: { name: 'castle.glb', file: { path: 'C:/art/castle.glb' }, material: 2, uvSet: 1 }
  }
}

describe('projects', () => {
  it('round-trips the document, files, maps and model', () => {
    const data = sample()
    const { project, warnings } = parseProject(serializeProject(data))
    expect(warnings).toEqual([])
    expect(project.textures.map(({ doc: _doc, ...t }) => t)).toEqual(data.textures.map(({ doc: _doc, ...t }) => t))
    expect(project.textures[0]!.doc).toBeUndefined()
    expect(project.textures[1]!.doc!.stages.map((s) => s.passId)).toEqual(data.textures[1]!.doc!.stages.map((s) => s.passId))
    expect(project.active).toBe(1)
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
    // A version 1 file: one texture with the maps.
    expect(project.textures).toEqual([
      { name: 'tex.png', png: 'AAAA', maps: [{ slot: 'ao', channel: 'luma', name: 'ao', file: { path: 'x.png' } }], materials: [] }
    ])
    expect(project.active).toBe(0)
    expect(project.model).toBeNull()
    expect(warnings).toHaveLength(2)
  })

  it('rejects files that are not projects', () => {
    expect(() => parseProject('nope')).toThrow(ProjectError)
    expect(() => parseProject('{"format":"4fxelizer-preset"}')).toThrow(ProjectError)
    expect(() => parseProject('{"format":"4fxelizer-project","version":99}')).toThrow(/newer version/)
  })

  it('signature ignores regenerated colors and the active texture but not edits, files, maps or stacks', () => {
    const doc = initialDoc()
    const texture = (id: string, path: string) => ({ id, image: { name: `${id}.png`, path, version: 1 }, maps: {}, materials: [] as number[] })
    const state: ProjectState = {
      docs: { shared: doc, separate: {} },
      textures: [{ ...texture('wall', 'C:/wall.png'), maps: { ao: { name: 'Baked AO', channel: 'luma', baked: true, version: 3 } } }, texture('roof', 'C:/roof.png')],
      model: null,
      modelMaterial: 0,
      modelUvSet: 0
    }
    const base = projectSignature(state)
    const regenerated = doc.palettes.map((p) => ({ ...p, colors: [{ hex: '#abcdef' }], generatedFor: 'k', variants: { wall: { colors: [{ hex: '#123456' }] } } }))
    expect(projectSignature({ ...state, docs: { shared: { ...doc, palettes: regenerated }, separate: {} } })).toBe(base)
    const [wall, roof] = state.textures
    expect(projectSignature({ ...state, textures: [{ ...wall!, image: { ...wall!.image, version: 2 } }, roof!] })).toBe(base) // reloaded from its file
    expect(projectSignature({ ...state, docs: { shared: { ...doc, stages: doc.stages.slice(1) }, separate: {} } })).not.toBe(base)
    expect(projectSignature({ ...state, docs: { shared: doc, separate: { roof: doc } } })).not.toBe(base)
    expect(projectSignature({ ...state, textures: [{ ...wall!, maps: { ao: { ...wall!.maps.ao!, version: 4 } } }, roof!] })).not.toBe(base)
    expect(projectSignature({ ...state, textures: [wall!, { ...roof!, materials: [1] }] })).not.toBe(base)
    expect(projectSignature({ ...state, textures: [wall!] })).not.toBe(base)
  })

  it('encodes bytes as base64 and back', () => {
    const bytes = new Uint8Array(100_000).map((_, i) => (i * 31) & 255)
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })
})
