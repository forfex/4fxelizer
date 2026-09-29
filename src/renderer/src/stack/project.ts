// Project files: the shared stack (like a preset, but with every palette color) plus the open
// textures (each with its maps, its separate stack if it has one, and the model materials drawn
// with it) and the model, referenced by path (see @shared/project). Maps baked from the model, and
// a texture or map that has no file of its own (a texture embedded in a model), are stored in the
// project as PNG. Version 1 files (one texture) still open.

import { MAP_CHANNELS, MAP_SLOTS, type MapChannel, type MapSlot } from '@shared/maps'
import type { ProjectFileRef } from '@shared/project'
import type { Doc } from './doc'
import { parseDoc } from './preset'

export const PROJECT_FORMAT = '4fxelizer-project'
export const PROJECT_VERSION = 2

/** A texture's pixels: a file, or (when it has none) a base64 PNG. */
export type ProjectImage = { name: string; file: ProjectFileRef } | { name: string; png: string }

/**
 * An open texture: its image, its maps, its separate stack (none = the shared one), the materials
 * drawn with it, and `liveReload: false` when its reload switch is off.
 */
export type ProjectTexture = ProjectImage & { maps: ProjectMap[]; doc?: Doc; materials: number[]; liveReload?: false }

/** An imported map (by file, or as PNG when it has none) or one baked from the model (as PNG). */
export type ProjectMap = { slot: MapSlot; channel: MapChannel; name: string } & ({ file: ProjectFileRef } | { png: string; baked?: true })

export interface ProjectModel {
  name: string
  file: ProjectFileRef
  /** Texture set (material index) an active texture drawn on no material shows on. */
  material: number
  uvSet: number
  /** Its reload switch is off. */
  liveReload?: false
}

export interface ProjectData {
  /** The shared stack. */
  doc: Doc
  presetName: string | null
  textures: ProjectTexture[]
  /** Index of the texture being worked on. */
  active: number
  model: ProjectModel | null
}

export class ProjectError extends Error {}

// All colors, so the palettes are right even before they regenerate (or when the texture is missing).
const docJson = (doc: Doc): Doc => ({
  stages: doc.stages,
  palettes: doc.palettes.map(({ generatedFor: _generatedFor, variants: _variants, ...p }) => p),
  outputLock: doc.outputLock
})

export function serializeProject(project: ProjectData): string {
  const file = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    doc: docJson(project.doc),
    presetName: project.presetName,
    textures: project.textures.map((t) => ({ ...t, ...(t.doc ? { doc: docJson(t.doc) } : {}) })),
    active: project.active,
    model: project.model
  }
  return JSON.stringify(file, null, 2)
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

function fileRefOf(raw: unknown): ProjectFileRef | null {
  if (!isObject(raw) || !str(raw.path)) return null
  const relative = str(raw.relative)
  return relative ? { path: raw.path as string, relative } : { path: raw.path as string }
}

const pngOf = (raw: unknown): string | null => (typeof raw === 'string' && raw.length > 0 && BASE64.test(raw) ? raw : null)

const index = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0)

export interface ParsedProject {
  project: ProjectData
  warnings: string[]
}

export function parseProject(json: string): ParsedProject {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new ProjectError('This file is not a 4FXELIZER project (invalid JSON).')
  }
  if (!isObject(raw) || raw.format !== PROJECT_FORMAT) throw new ProjectError('This file is not a 4FXELIZER project.')
  if (typeof raw.version === 'number' && raw.version > PROJECT_VERSION) {
    throw new ProjectError('This project was made by a newer version of 4FXELIZER. Update the app to open it.')
  }
  const warnings: string[] = []
  const doc = parseDoc(isObject(raw.doc) ? raw.doc : {}, warnings)

  const textures: ProjectTexture[] = []
  if (raw.version === 1 || raw.version === undefined) {
    // One texture, with the maps next to it.
    const image = isObject(raw.texture) ? imageOf(raw.texture, warnings) : null
    const maps = mapsOf(raw.maps, warnings)
    if (image) textures.push({ ...image, maps, materials: [] })
  } else {
    for (const t of Array.isArray(raw.textures) ? raw.textures : []) {
      if (!isObject(t)) continue
      const image = imageOf(t, warnings)
      if (!image) continue
      const separate = isObject(t.doc) ? parseDoc(t.doc, warnings) : undefined
      const materials = Array.isArray(t.materials) ? [...new Set(t.materials.filter((m): m is number => typeof m === 'number' && Number.isInteger(m) && m >= 0))] : []
      textures.push({ ...image, maps: mapsOf(t.maps, warnings), ...(separate ? { doc: separate } : {}), materials, ...(t.liveReload === false ? { liveReload: false as const } : {}) })
    }
  }
  const active = Math.min(index(raw.active), Math.max(textures.length - 1, 0))

  let model: ProjectModel | null = null
  if (isObject(raw.model)) {
    const file = fileRefOf(raw.model.file)
    if (file) {
      model = { name: str(raw.model.name) ?? 'model', file, material: index(raw.model.material), uvSet: index(raw.model.uvSet) }
      if (raw.model.liveReload === false) model.liveReload = false
    }
    else warnings.push('The model entry is broken.')
  }

  const presetName = str(raw.presetName)?.slice(0, 100) ?? null
  return { project: { doc, presetName, textures, active, model }, warnings }
}

function imageOf(raw: Record<string, unknown>, warnings: string[]): ProjectImage | null {
  const name = str(raw.name) ?? 'texture'
  const file = fileRefOf(raw.file)
  const png = pngOf(raw.png)
  const image = file ? { name, file } : png ? { name, png } : null
  if (!image) warnings.push(`The texture entry ${name} is broken.`)
  return image
}

function mapsOf(raw: unknown, warnings: string[]): ProjectMap[] {
  const maps: ProjectMap[] = []
  for (const m of Array.isArray(raw) ? raw : []) {
    if (!isObject(m)) continue
    const slot = MAP_SLOTS.find((s) => s.id === m.slot)?.id
    if (!slot || maps.some((x) => x.slot === slot)) continue
    const channel = MAP_CHANNELS.find((c) => c.id === m.channel)?.id ?? 'luma'
    const name = str(m.name) ?? slot
    const file = fileRefOf(m.file)
    const png = pngOf(m.png)
    if (file) maps.push({ slot, channel, name, file })
    else if (png) maps.push({ slot, channel, name, png, ...(m.baked === true ? { baked: true as const } : {}) })
    else warnings.push(`The ${slot} map entry is broken.`)
  }
  return maps
}

type SignatureMaps = Partial<Record<MapSlot, { name: string; channel: MapChannel; path?: string; baked?: boolean; version: number }>>

/** What a project stores of the app state (the parts that make it "modified"). */
export interface ProjectState {
  docs: { shared: Doc; separate: Record<string, Doc> }
  textures: { id: string; image: { name: string; path?: string; version: number }; maps: SignatureMaps; materials: number[]; liveReload?: boolean }[]
  model: { name: string; path?: string; liveReload?: boolean } | null
  modelMaterial: number
  modelUvSet: number
}

/** A stack as it counts for "modified": colors of auto-generated palettes left out (they regenerate). */
function docSignature(doc: Doc): unknown {
  const palettes = doc.palettes.map(({ generatedFor: _generatedFor, variants: _variants, ...p }) => (p.generator?.auto ? { ...p, colors: p.colors.filter((c) => c.locked) } : p))
  return { stages: doc.stages, palettes, outputLock: doc.outputLock }
}

/**
 * A fingerprint of what a project saves. Colors of auto-generated palettes are left out: they
 * follow from the rest (and regenerate after loading without changing anything). Which texture
 * is being worked on doesn't count.
 */
export function projectSignature(s: ProjectState): string {
  return JSON.stringify({
    shared: docSignature(s.docs.shared),
    textures: s.textures.map((t) => ({
      image: t.image.path ?? `${t.image.name}#${t.image.version}`,
      maps: MAP_SLOTS.flatMap(({ id }) => {
        const m = t.maps[id]
        if (!m) return []
        return [[id, m.channel, m.baked ? `baked#${m.version}` : (m.path ?? `${m.name}#${m.version}`)]]
      }),
      doc: s.docs.separate[t.id] ? docSignature(s.docs.separate[t.id]!) : null,
      materials: t.materials,
      liveReload: t.liveReload !== false
    })),
    model: s.model && [s.model.path ?? s.model.name, s.modelMaterial, s.modelUvSet, s.model.liveReload !== false]
  })
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
