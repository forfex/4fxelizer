// The undoable document (stage stack + palettes + output lock) and pure edits on it that keep
// stage-owned "generated" palettes consistent with their stages.

import { DEFAULT_BLEND } from '@/gpu/pass'
import { STAGE_TYPES, stageLabel } from '@/gpu/passes'
import type { StageSpec } from '@/gpu/plan'
import { DEFAULT_GENERATOR, type GenerateMethod, type Palette } from '@/palette/palette'
import type { OutputLock } from './analyze'

export interface Doc {
  stages: StageSpec[]
  palettes: Palette[]
  outputLock: OutputLock
}

/** Params shared by stages that read a palette (Quantize, Dither). */
export interface PaletteParams {
  paletteId: string | null
  /** Color count used when the stage switches to a generated palette. */
  autoColors: number
  /** Project palette to return to when the stage switches back from generated. */
  projectPaletteId: string | null
}

export const DEFAULT_AUTO_COLORS = 16

export const newId = (prefix: string): string => `${prefix}-${crypto.randomUUID().slice(0, 8)}`

export function readsPalette(stage: StageSpec): boolean {
  return stage.passId === 'quantize' || stage.passId === 'dither'
}

const paletteParams = (stage: StageSpec): PaletteParams => stage.params as PaletteParams

/** The generated palette a stage owns, if it has one. */
export function ownedPalette(doc: Pick<Doc, 'palettes'>, uid: string): Palette | undefined {
  return doc.palettes.find((p) => p.ownerUid === uid)
}

/** True when the stage currently uses its own generated palette. */
export function usesGeneratedPalette(doc: Pick<Doc, 'palettes'>, stage: StageSpec): boolean {
  const owned = ownedPalette(doc, stage.uid)
  return !!owned && paletteParams(stage).paletteId === owned.id
}

export function makeOwnedPalette(stage: StageSpec, count: number, method: GenerateMethod = DEFAULT_GENERATOR.method): Palette {
  return {
    id: newId('pal'),
    name: `${stageLabel(stage.passId)} (generated)`,
    colors: [],
    generator: { ...DEFAULT_GENERATOR, method, count, from: { kind: 'stage', uid: stage.uid }, auto: true },
    ownerUid: stage.uid
  }
}

/** A new stage with default params; palette stages get their own generated palette. */
export function makeStage(passId: string): { stage: StageSpec; palettes: Palette[] } {
  const type = STAGE_TYPES.find((t) => t.passId === passId)
  if (!type) throw new Error(`Unknown stage type "${passId}"`)
  const stage: StageSpec = {
    uid: newId(passId),
    passId,
    params: structuredClone(type.defaults),
    enabled: true,
    blend: { ...DEFAULT_BLEND }
  }
  if (!readsPalette(stage)) return { stage, palettes: [] }
  const palette = makeOwnedPalette(stage, paletteParams(stage).autoColors ?? DEFAULT_AUTO_COLORS)
  stage.params = { ...(stage.params as object), paletteId: palette.id }
  return { stage, palettes: [palette] }
}

function patchParams(doc: Doc, uid: string, patch: Partial<PaletteParams>): StageSpec[] {
  return doc.stages.map((s) => (s.uid === uid ? { ...s, params: { ...(s.params as object), ...patch } } : s))
}

/** Switches a stage to its own palette, generated from its input. */
export function toGeneratedPalette(doc: Doc, uid: string): Partial<Doc> {
  const stage = doc.stages.find((s) => s.uid === uid)
  if (!stage || !readsPalette(stage) || usesGeneratedPalette(doc, stage)) return {}
  const params = paletteParams(stage)
  const palette = ownedPalette(doc, uid) ?? makeOwnedPalette(stage, params.autoColors ?? DEFAULT_AUTO_COLORS)
  return {
    stages: patchParams(doc, uid, { paletteId: palette.id, projectPaletteId: params.paletteId }),
    palettes: doc.palettes.some((p) => p.id === palette.id) ? doc.palettes : [...doc.palettes, palette]
  }
}

/** Switches a stage back to a project palette and drops its generated one (remembering the count). */
export function toProjectPalette(doc: Doc, uid: string, fallbackId: string | null): Partial<Doc> {
  const stage = doc.stages.find((s) => s.uid === uid)
  if (!stage || !readsPalette(stage)) return {}
  const owned = ownedPalette(doc, uid)
  const remaining = doc.palettes.filter((p) => p !== owned)
  const exists = (id: string | null | undefined): id is string => !!id && remaining.some((p) => p.id === id)
  const params = paletteParams(stage)
  const paletteId = exists(params.projectPaletteId)
    ? params.projectPaletteId
    : exists(fallbackId)
      ? fallbackId
      : (remaining.find((p) => !p.ownerUid)?.id ?? null)
  return {
    stages: patchParams(doc, uid, { paletteId, autoColors: owned?.generator?.count ?? params.autoColors }),
    palettes: remaining,
    outputLock: owned && doc.outputLock.paletteId === owned.id ? { ...doc.outputLock, paletteId } : doc.outputLock
  }
}

/** Inserts a copy of a stage right after it; a generated palette is copied too. */
export function duplicateStage(doc: Doc, uid: string): Partial<Doc> {
  const i = doc.stages.findIndex((s) => s.uid === uid)
  if (i < 0) return {}
  const original = doc.stages[i]!
  const copy: StageSpec = { ...structuredClone(original), uid: newId(original.passId) }
  const palettes = [...doc.palettes]
  const owned = ownedPalette(doc, uid)
  if (owned) {
    const clone: Palette = {
      ...structuredClone(owned),
      id: newId('pal'),
      ownerUid: copy.uid,
      generator: { ...owned.generator!, from: { kind: 'stage', uid: copy.uid } }
    }
    palettes.push(clone)
    if (paletteParams(original).paletteId === owned.id) copy.params = { ...(copy.params as object), paletteId: clone.id }
  }
  const stages = [...doc.stages]
  stages.splice(i + 1, 0, copy)
  return { stages, palettes }
}

/** Removes a stage and the palette it owns. */
export function removeStage(doc: Doc, uid: string): Partial<Doc> {
  const owned = ownedPalette(doc, uid)
  const palettes = doc.palettes.filter((p) => p !== owned)
  return {
    stages: doc.stages.filter((s) => s.uid !== uid),
    palettes,
    outputLock:
      owned && doc.outputLock.paletteId === owned.id
        ? { ...doc.outputLock, paletteId: palettes.find((p) => !p.ownerUid)?.id ?? null }
        : doc.outputLock
  }
}

/** Default document: Adjust → Downscale → Dither with a 16-color palette generated from its input. */
export function initialDoc(): Doc {
  const adjust = makeStage('adjust')
  const downscale = makeStage('downscale')
  const dither = makeStage('dither')
  return {
    stages: [adjust.stage, downscale.stage, dither.stage],
    palettes: dither.palettes,
    outputLock: { enabled: false, paletteId: dither.palettes[0]!.id }
  }
}
