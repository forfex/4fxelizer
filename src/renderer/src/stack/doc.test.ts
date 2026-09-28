import { describe, expect, it } from 'vitest'
import type { DitherParams } from '@/gpu/passes/dither'
import {
  duplicateStage,
  initialDoc,
  makeStage,
  ownedPalette,
  removeStage,
  toGeneratedPalette,
  toProjectPalette,
  usesGeneratedPalette,
  type Doc
} from './doc'

const apply = (doc: Doc, patch: Partial<Doc>): Doc => ({ ...doc, ...patch })
const params = (doc: Doc, uid: string) => doc.stages.find((s) => s.uid === uid)!.params as DitherParams

function docWithProjectPalette(): { doc: Doc; uid: string } {
  const doc = initialDoc()
  const project = { id: 'proj', name: 'PICO-8', colors: [{ hex: '#000000' }] }
  return { doc: { ...doc, palettes: [...doc.palettes, project] }, uid: doc.stages[2]!.uid }
}

describe('stage-owned generated palettes', () => {
  it('new palette stages generate their own palette from their input', () => {
    const { stage, palettes } = makeStage('dither')
    expect(palettes).toHaveLength(1)
    expect(palettes[0]!.ownerUid).toBe(stage.uid)
    expect(palettes[0]!.generator).toMatchObject({ count: 16, auto: true, from: { kind: 'stage', uid: stage.uid } })
    expect((stage.params as DitherParams).paletteId).toBe(palettes[0]!.id)
    expect(makeStage('adjust').palettes).toEqual([])
  })

  it('switches to a project palette and back, remembering both choices', () => {
    let { doc, uid } = docWithProjectPalette()
    const owned = ownedPalette(doc, uid)!
    doc = apply(doc, { palettes: doc.palettes.map((p) => (p === owned ? { ...p, generator: { ...p.generator!, count: 300 } } : p)) })

    doc = apply(doc, toProjectPalette(doc, uid, 'proj'))
    expect(ownedPalette(doc, uid)).toBeUndefined()
    expect(params(doc, uid)).toMatchObject({ paletteId: 'proj', autoColors: 300 })

    doc = apply(doc, toGeneratedPalette(doc, uid))
    const again = ownedPalette(doc, uid)!
    expect(again.generator!.count).toBe(300)
    expect(params(doc, uid)).toMatchObject({ paletteId: again.id, projectPaletteId: 'proj' })
    expect(usesGeneratedPalette(doc, doc.stages[2]!)).toBe(true)

    doc = apply(doc, toProjectPalette(doc, uid, null))
    expect(params(doc, uid).paletteId).toBe('proj')
  })

  it('moves the output lock off a palette that is removed', () => {
    let { doc, uid } = docWithProjectPalette()
    doc = { ...doc, outputLock: { enabled: true, paletteId: ownedPalette(doc, uid)!.id } }
    expect(apply(doc, toProjectPalette(doc, uid, 'proj')).outputLock.paletteId).toBe('proj')
    expect(apply(doc, removeStage(doc, uid)).outputLock.paletteId).toBe('proj')
  })

  it('duplicates a stage with its own copy of the generated palette', () => {
    const { doc, uid } = docWithProjectPalette()
    const next = apply(doc, duplicateStage(doc, uid))
    const copy = next.stages[3]!
    const copyPalette = ownedPalette(next, copy.uid)!
    expect(copyPalette.id).not.toBe(ownedPalette(doc, uid)!.id)
    expect(copyPalette.generator!.from).toEqual({ kind: 'stage', uid: copy.uid })
    expect((copy.params as DitherParams).paletteId).toBe(copyPalette.id)
  })

  it('removes the palette together with its stage', () => {
    const { doc, uid } = docWithProjectPalette()
    const next = apply(doc, removeStage(doc, uid))
    expect(next.stages).toHaveLength(2)
    expect(next.palettes.map((p) => p.id)).toEqual(['proj'])
  })
})
