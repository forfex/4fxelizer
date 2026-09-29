// Project files: the document (like a preset, but with every palette color) plus the texture, the
// imported maps and the model it was made with, referenced by path (see @shared/project). Maps
// baked from the model, and a texture or map that has no file of its own (a texture embedded in a
// model), are stored in the project as PNG.

import { MAP_CHANNELS, MAP_SLOTS, type MapChannel, type MapSlot } from '@shared/maps'
import type { ProjectFileRef } from '@shared/project'
import type { Doc } from './doc'
import { parseDoc } from './preset'

export const PROJECT_FORMAT = '4fxelizer-project'
export const PROJECT_VERSION = 1

/** The texture: a file, or (when it has none) its pixels as a base64 PNG. */
export type ProjectTexture = { name: string; file: ProjectFileRef } | { name: string; png: string }

/** An imported map (by file, or as PNG when it has none) or one baked from the model (as PNG). */
export type ProjectMap = { slot: MapSlot; channel: MapChannel; name: string } & ({ file: ProjectFileRef } | { png: string; baked?: true })

export interface ProjectModel {
  name: string
  file: ProjectFileRef
  /** Texture set (material index) the texture belongs to. */
  material: number
  uvSet: number
}

export interface ProjectData {
  doc: Doc
  presetName: string | null
  texture: ProjectTexture | null
  maps: ProjectMap[]
  model: ProjectModel | null
}

export class ProjectError extends Error {}

export function serializeProject(project: ProjectData): string {
  const { doc } = project
  const file = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    // All colors, so the palettes are right even before they regenerate (or when the texture is missing).
    doc: { stages: doc.stages, palettes: doc.palettes.map(({ generatedFor: _generatedFor, variants: _variants, ...p }) => p), outputLock: doc.outputLock },
    presetName: project.presetName,
    texture: project.texture,
    maps: project.maps,
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

  let texture: ProjectTexture | null = null
  if (isObject(raw.texture)) {
    const name = str(raw.texture.name) ?? 'texture'
    const file = fileRefOf(raw.texture.file)
    const png = pngOf(raw.texture.png)
    texture = file ? { name, file } : png ? { name, png } : null
    if (!texture) warnings.push('The texture entry is broken.')
  }

  const maps: ProjectMap[] = []
  for (const m of Array.isArray(raw.maps) ? raw.maps : []) {
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

  let model: ProjectModel | null = null
  if (isObject(raw.model)) {
    const file = fileRefOf(raw.model.file)
    if (file) model = { name: str(raw.model.name) ?? 'model', file, material: index(raw.model.material), uvSet: index(raw.model.uvSet) }
    else warnings.push('The model entry is broken.')
  }

  const presetName = str(raw.presetName)?.slice(0, 100) ?? null
  return { project: { doc, presetName, texture, maps, model }, warnings }
}

/** What a project stores of the app state (the parts that make it "modified"). */
export interface ProjectState extends Doc {
  image: { name: string; path?: string; version: number } | null
  maps: Partial<Record<MapSlot, { name: string; channel: MapChannel; path?: string; baked?: boolean; version: number }>>
  model: { name: string; path?: string } | null
  modelMaterial: number
  modelUvSet: number
}

/**
 * A fingerprint of what a project saves. Colors of auto-generated palettes are left out: they
 * follow from the rest (and regenerate after loading without changing anything).
 */
export function projectSignature(s: ProjectState): string {
  const palettes = s.palettes.map(({ generatedFor: _generatedFor, variants: _variants, ...p }) => (p.generator?.auto ? { ...p, colors: p.colors.filter((c) => c.locked) } : p))
  const maps = MAP_SLOTS.flatMap(({ id }) => {
    const m = s.maps[id]
    if (!m) return []
    return [[id, m.channel, m.baked ? `baked#${m.version}` : (m.path ?? `${m.name}#${m.version}`)]]
  })
  return JSON.stringify({
    stages: s.stages,
    palettes,
    outputLock: s.outputLock,
    image: s.image && (s.image.path ?? `${s.image.name}#${s.image.version}`),
    maps,
    model: s.model && [s.model.path ?? s.model.name, s.modelMaterial, s.modelUvSet]
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
