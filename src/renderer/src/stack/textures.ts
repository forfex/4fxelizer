// The open textures and the stacks they're processed with. Every texture uses the shared stack
// unless it has a separate one of its own; undo history holds these documents together, so one
// history covers every texture.

import type { MapSlot } from '@shared/maps'
import type { ImageInfo, MapInfo } from '@/store'
import type { View } from '@/viewer/viewport'
import type { Doc } from './doc'

export type TextureMaps = Partial<Record<MapSlot, MapInfo>>

export interface TextureEntry {
  id: string
  image: ImageInfo
  /** Imported and baked maps of this texture, by slot. */
  maps: TextureMaps
  /** Small preview of the texture as loaded (data URL). */
  thumbnail: string | null
  /** Model materials (texture sets) drawn with this texture. */
  materials: number[]
  /** Zoom and pan it was last shown with. */
  view: View | null
}

/** The shared stack and the separate stacks of textures that have one (by texture id). */
export interface Docs {
  shared: Doc
  separate: Record<string, Doc>
}

/** Which document a texture uses: 'shared' or its own id. */
export type DocKey = string
export const SHARED: DocKey = 'shared'

export function docKeyOf(docs: Docs, textureId: string | null): DocKey {
  return textureId && docs.separate[textureId] ? textureId : SHARED
}

export function docAt(docs: Docs, key: DocKey): Doc {
  return (key !== SHARED && docs.separate[key]) || docs.shared
}

export function withDoc(docs: Docs, key: DocKey, doc: Doc): Docs {
  if (key === SHARED) return { ...docs, shared: doc }
  return { ...docs, separate: { ...docs.separate, [key]: doc } }
}

export function hasSeparateStack(docs: Docs, textureId: string): boolean {
  return !!docs.separate[textureId]
}

/** Gives a texture a separate stack, starting as a copy of the shared one. */
export function makeSeparate(docs: Docs, textureId: string): Docs {
  if (docs.separate[textureId]) return docs
  return withDoc(docs, textureId, structuredClone(docs.shared))
}

/** Puts a texture back on the shared stack (its separate stack is dropped). */
export function makeShared(docs: Docs, textureId: string): Docs {
  if (!docs.separate[textureId]) return docs
  const { [textureId]: _dropped, ...separate } = docs.separate
  return { ...docs, separate }
}

/** Documents that differ between two states (added, removed or changed), shared first. */
export function changedDocKeys(a: Docs, b: Docs): DocKey[] {
  const keys: DocKey[] = []
  if (a.shared !== b.shared) keys.push(SHARED)
  for (const id of new Set([...Object.keys(a.separate), ...Object.keys(b.separate)])) {
    if (a.separate[id] !== b.separate[id]) keys.push(id)
  }
  return keys
}

/**
 * The texture to show for a change in document `key`: the active one when it uses that document,
 * else the texture with that separate stack, else the first on the shared stack. Null when no open
 * texture uses it.
 */
export function textureForDoc(textures: readonly TextureEntry[], docs: Docs, key: DocKey, active: string | null): string | null {
  if (active && docKeyOf(docs, active) === key) return active
  if (key !== SHARED) return textures.some((t) => t.id === key) ? key : null
  return textures.find((t) => docKeyOf(docs, t.id) === SHARED)?.id ?? null
}

/** The texture to select after closing `id`: its right neighbor, else its left one. */
export function neighborOf(textures: readonly TextureEntry[], id: string): string | null {
  const i = textures.findIndex((t) => t.id === id)
  if (i < 0) return null
  return textures[i + 1]?.id ?? textures[i - 1]?.id ?? null
}

/** Textures without the closed one, and the documents without its separate stack. */
export function closeTexture(textures: readonly TextureEntry[], docs: Docs, id: string): { textures: TextureEntry[]; docs: Docs } {
  return { textures: textures.filter((t) => t.id !== id), docs: makeShared(docs, id) }
}

/** Replaces one texture's entry. */
export function updateTexture(textures: readonly TextureEntry[], id: string, patch: Partial<Omit<TextureEntry, 'id'>>): TextureEntry[] {
  return textures.map((t) => (t.id === id ? { ...t, ...patch } : t))
}

/** The textures on the shared stack. */
export function sharedTextures(textures: readonly TextureEntry[], docs: Docs): TextureEntry[] {
  return textures.filter((t) => !docs.separate[t.id])
}
