// Presets: the document (stage stack, palettes, output lock) as a JSON file, so a look made on one
// texture can be reapplied to others. Loading validates everything, fills in missing settings with
// defaults (older presets keep working) and gives stages and palettes fresh ids.

import { MASK_COMBINE, MASK_SOURCES, MAX_MASK_BLUR, normalizeMask, type MaskSource, type MaskSpec } from '@/gpu/mask'
import { BLEND_MODES, DEFAULT_BLEND, type StageBlend } from '@/gpu/pass'
import { STAGE_TYPES } from '@/gpu/passes'
import type { StageSpec } from '@/gpu/plan'
import { DEFAULT_GENERATOR, GENERATE_METHODS, MAX_PALETTE, normalizeHex, type GeneratorSettings, type Palette, type PaletteColor } from '@/palette/palette'
import { newId, type Doc, type PaletteParams } from './doc'

export const PRESET_FORMAT = '4fxelizer-preset'
export const PRESET_VERSION = 1
export const PRESET_EXTENSION = 'pxlook'
/** Extension presets had before; such files still load. */
export const LEGACY_PRESET_EXTENSION = '4fxpreset'

export interface PresetFile extends Doc {
  format: typeof PRESET_FORMAT
  version: number
  name: string
}

export class PresetError extends Error {}

/**
 * Serializes the document. Palettes that regenerate automatically are saved without their colors
 * (only locked ones), since they are rebuilt from whatever texture the preset is applied to.
 */
export function serializePreset(doc: Doc, name: string): string {
  const palettes = doc.palettes.map(({ generatedFor: _generatedFor, variants: _variants, ...p }) =>
    p.generator?.auto ? { ...p, colors: p.colors.filter((c) => c.locked) } : p
  )
  // Pick the document fields explicitly: callers may pass the whole app state.
  const file: PresetFile = {
    format: PRESET_FORMAT,
    version: PRESET_VERSION,
    name,
    stages: doc.stages,
    palettes,
    outputLock: doc.outputLock
  }
  return JSON.stringify(file, null, 2)
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

/** Keeps only keys the stage type knows, with values of the default's type. */
function cleanParams(defaults: object, raw: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = { ...structuredClone(defaults) }
  if (!isObject(raw)) return out
  for (const [key, def] of Object.entries(defaults)) {
    const value = raw[key]
    if (value === undefined) continue
    if (def === null ? value === null || typeof value === 'string' : typeof value === typeof def) out[key] = value
  }
  return out
}

function cleanBlend(raw: unknown): StageBlend {
  if (!isObject(raw)) return { ...DEFAULT_BLEND }
  const mode = BLEND_MODES.find((m) => m.id === raw.mode)?.id ?? DEFAULT_BLEND.mode
  const mask = cleanMask(raw.mask)
  return { opacity: Math.min(Math.max(num(raw.opacity, 1), 0), 1), mode, ...(mask ? { mask } : {}) }
}

function cleanMask(raw: unknown): MaskSpec | null {
  if (!isObject(raw)) return null
  const source = (v: unknown): MaskSource => MASK_SOURCES.find((m) => m.id === v)?.id ?? 'none'
  const amount = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : undefined)
  return normalizeMask({
    a: source(raw.a),
    aInvert: raw.aInvert === true,
    aAmount: amount(raw.aAmount),
    b: source(raw.b),
    bInvert: raw.bInvert === true,
    bAmount: amount(raw.bAmount),
    combine: MASK_COMBINE.find((m) => m.id === raw.combine)?.id ?? 'multiply',
    blur: Math.min(Math.max(num(raw.blur, 0), 0), MAX_MASK_BLUR),
    wrap: raw.wrap === true
  })
}

function cleanGenerator(raw: unknown): GeneratorSettings | undefined {
  if (!isObject(raw)) return undefined
  const gamma = Math.min(Math.max(num(raw.gamma, 1), 0.2), 5)
  const from = isObject(raw.from) && raw.from.kind === 'stage' && str(raw.from.uid)
    ? { kind: 'stage' as const, uid: raw.from.uid as string }
    : { kind: 'source' as const }
  return {
    method: GENERATE_METHODS.find((m) => m.id === raw.method)?.id ?? 'kmeans',
    count: Math.round(Math.min(Math.max(num(raw.count, DEFAULT_GENERATOR.count), 2), MAX_PALETTE)),
    quality: Math.round(Math.min(Math.max(num(raw.quality, DEFAULT_GENERATOR.quality), 1), 64)),
    lumaWeight: num(raw.lumaWeight, 1),
    chromaWeight: num(raw.chromaWeight, 1),
    from,
    auto: raw.auto !== false,
    // Only when set, so palettes without them keep their generation key.
    ...(gamma !== 1 ? { gamma } : {}),
    ...(raw.color15 === true ? { color15: true } : {}),
    ...(raw.scope === 'all' ? { scope: 'all' as const } : {})
  }
}

function cleanColors(raw: unknown): PaletteColor[] {
  if (!Array.isArray(raw)) return []
  const colors: PaletteColor[] = []
  for (const c of raw.slice(0, MAX_PALETTE)) {
    const hex = normalizeHex(str(isObject(c) ? c.hex : c) ?? '')
    if (hex) colors.push(isObject(c) && c.locked === true ? { hex, locked: true } : { hex })
  }
  return colors
}

export interface ParsedPreset {
  name: string
  doc: Doc
  /** Parts of the file that were skipped (unknown stage types, broken references). */
  warnings: string[]
}

export function parsePreset(json: string): ParsedPreset {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new PresetError('This file is not a 4FXELIZER preset (invalid JSON).')
  }
  if (!isObject(raw) || raw.format !== PRESET_FORMAT) throw new PresetError('This file is not a 4FXELIZER preset.')
  if (num(raw.version, 0) > PRESET_VERSION) {
    throw new PresetError('This preset was made by a newer version of 4FXELIZER. Update the app to load it.')
  }
  const warnings: string[] = []
  const doc = parseDoc(raw, warnings)
  if (!doc.stages.length && !doc.palettes.length) warnings.push('The preset is empty.')
  return { name: str(raw.name)?.slice(0, 100) || 'Preset', doc, warnings }
}

/**
 * The document fields (stages, palettes, output lock) of a preset or project: validated, with
 * defaults filled in and fresh ids. Skipped parts are added to `warnings`.
 */
export function parseDoc(raw: Record<string, unknown>, warnings: string[]): Doc {

  // Fresh ids, so a preset can be loaded any number of times.
  const stageIds = new Map<string, string>()
  const paletteIds = new Map<string, string>()

  const stages: StageSpec[] = []
  for (const s of Array.isArray(raw.stages) ? raw.stages : []) {
    if (!isObject(s)) continue
    const type = STAGE_TYPES.find((t) => t.passId === s.passId)
    if (!type) {
      warnings.push(`Skipped an unknown stage type "${String(s.passId)}".`)
      continue
    }
    const uid = newId(type.passId)
    if (str(s.uid)) stageIds.set(s.uid as string, uid)
    stages.push({ uid, passId: type.passId, params: cleanParams(type.defaults, s.params), enabled: s.enabled !== false, blend: cleanBlend(s.blend) })
  }

  const palettes: Palette[] = []
  for (const p of Array.isArray(raw.palettes) ? raw.palettes : []) {
    if (!isObject(p)) continue
    const id = newId('pal')
    if (str(p.id)) paletteIds.set(p.id as string, id)
    const palette: Palette = { id, name: str(p.name)?.slice(0, 100) || 'Palette', colors: cleanColors(p.colors) }
    const generator = cleanGenerator(p.generator)
    if (generator) palette.generator = generator
    if (str(p.ownerUid)) palette.ownerUid = p.ownerUid as string
    palettes.push(palette)
  }

  // Rewrite references to the new ids.
  for (const p of palettes) {
    if (p.ownerUid) {
      const owner = stageIds.get(p.ownerUid)
      if (owner) p.ownerUid = owner
      else delete p.ownerUid
    }
    if (p.generator?.from.kind === 'stage') {
      const uid = stageIds.get(p.generator.from.uid)
      p.generator.from = uid ? { kind: 'stage', uid } : { kind: 'source' }
    }
  }
  const remapPalette = (id: unknown): string | null => (typeof id === 'string' ? (paletteIds.get(id) ?? null) : null)
  for (const s of stages) {
    const params = s.params as Partial<PaletteParams>
    if ('paletteId' in params) {
      const had = params.paletteId
      params.paletteId = remapPalette(had)
      params.projectPaletteId = remapPalette(params.projectPaletteId)
      if (had && !params.paletteId) warnings.push('A stage referenced a palette that is missing from the file.')
    }
  }

  const lock = isObject(raw.outputLock) ? raw.outputLock : {}
  const outputLock = { enabled: lock.enabled === true, paletteId: remapPalette(lock.paletteId) }
  return { stages, palettes, outputLock }
}

/** File-system-safe preset name (the main process sanitizes again). */
export function presetFileName(name: string): string {
  const safe = name.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_').replace(/^[ .]+|[ .]+$/g, '').slice(0, 80)
  return `${safe || 'preset'}.${PRESET_EXTENSION}`
}
