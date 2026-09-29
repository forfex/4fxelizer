// The open textures and the stacks they're processed with. Every texture uses the shared stack
// unless it has a separate one of its own; undo history holds these documents together, so one
// history covers every texture.

import type { MapSlot } from '@shared/maps'
import type { ImageInfo, MapInfo } from '@/store'
import type { View } from '@/viewer/viewport'
import type { Palette, PaletteColor } from '@/palette/palette'
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
  /** false: it and its maps don't reload when live reload is set to per file. */
  liveReload?: boolean
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
  // With the colors generated for this texture, not the ones last shown for another.
  const { palettes, ...doc } = withVariants(docs.shared, textureId)
  return withDoc(docs, textureId, structuredClone({ ...doc, palettes: palettes.map(({ variants: _v, ...p }) => p) }))
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

/** Textures without the closed one, and the documents without its separate stack or its generated colors. */
export function closeTexture(textures: readonly TextureEntry[], docs: Docs, id: string): { textures: TextureEntry[]; docs: Docs } {
  const shared = docs.shared.palettes.some((p) => p.variants?.[id])
    ? {
        ...docs.shared,
        palettes: docs.shared.palettes.map((p) => {
          if (!p.variants?.[id]) return p
          const { [id]: _dropped, ...variants } = p.variants
          return { ...p, variants }
        })
      }
    : docs.shared
  return { textures: textures.filter((t) => t.id !== id), docs: makeShared({ ...docs, shared }, id) }
}

/** Whether a palette gets colors of its own per texture (generated per texture, on the shared stack). */
export function perTexture(palette: Palette, key: DocKey): boolean {
  return key === SHARED && !!palette.generator && palette.generator.scope !== 'all'
}

/** A document as texture `id` sees it: palettes generated per texture show its colors. */
export function withVariants(doc: Doc, textureId: string | null): Doc {
  const variantOf = (p: Palette) => (textureId && perTexture(p, SHARED) ? p.variants?.[textureId] : undefined)
  if (!doc.palettes.some(variantOf)) return doc
  return {
    ...doc,
    palettes: doc.palettes.map((p) => {
      const v = variantOf(p)
      return v ? { ...p, colors: v.colors, generatedFor: v.generatedFor } : p
    })
  }
}

/**
 * The shared document after an edit made while texture `textureId` was shown: palettes generated
 * per texture keep the edited colors (a picked color, a hand edit) as that texture's own, so
 * docFor() doesn't bring back the ones from before.
 */
export function keepVariants(doc: Doc, textureId: string | null): Doc {
  const stale = (p: Palette): boolean => {
    const v = textureId && perTexture(p, SHARED) ? p.variants?.[textureId] : undefined
    return !!v && (v.colors !== p.colors || v.generatedFor !== p.generatedFor)
  }
  if (!doc.palettes.some(stale)) return doc
  return {
    ...doc,
    palettes: doc.palettes.map((p) => (stale(p) ? { ...p, variants: { ...p.variants, [textureId!]: { colors: p.colors, generatedFor: p.generatedFor } } } : p))
  }
}

/** The document a texture is processed with (its stack, and the colors generated for it). */
export function docFor(docs: Docs, textureId: string): Doc {
  const key = docKeyOf(docs, textureId)
  return key === SHARED ? withVariants(docs.shared, textureId) : docAt(docs, key)
}

/**
 * Documents with new generated colors for a palette: for texture `textureId` (its own colors when
 * generated per texture; the palette's colors change too when it's the `active` one), or for every
 * texture on the stack (null, or a palette generated from all textures).
 */
export function setGenerated(
  docs: Docs,
  textureId: string | null,
  paletteId: string,
  colors: PaletteColor[],
  generatedFor: string,
  active: string | null
): Docs {
  const key = textureId ? docKeyOf(docs, textureId) : SHARED
  const doc = docAt(docs, key)
  const palettes = doc.palettes.map((p) => {
    if (p.id !== paletteId) return p
    if (textureId && perTexture(p, key)) {
      const variants = { ...p.variants, [textureId]: { colors, generatedFor } }
      return textureId === active ? { ...p, colors, generatedFor, variants } : { ...p, variants }
    }
    return { ...p, colors, generatedFor }
  })
  return withDoc(docs, key, { ...doc, palettes })
}

/** Replaces one texture's entry. */
export function updateTexture(textures: readonly TextureEntry[], id: string, patch: Partial<Omit<TextureEntry, 'id'>>): TextureEntry[] {
  return textures.map((t) => (t.id === id ? { ...t, ...patch } : t))
}

/** Binds materials to a texture (a material is drawn with one texture: other textures lose it). */
export function assignMaterials(textures: readonly TextureEntry[], id: string, materials: readonly number[]): TextureEntry[] {
  return textures.map((t) => {
    if (t.id === id) return { ...t, materials: [...new Set(materials)].sort((a, b) => a - b) }
    const kept = t.materials.filter((m) => !materials.includes(m))
    return kept.length === t.materials.length ? t : { ...t, materials: kept }
  })
}

/**
 * The texture each material of a model is drawn with: the one bound to it; a one-material model
 * shows the active texture; otherwise an active texture bound to no material shows on the
 * `fallback` material (the texture set picked for it).
 */
export function partTextures(materialCount: number, textures: readonly TextureEntry[], active: string | null, fallback: number): (string | null)[] {
  const activeEntry = textures.find((t) => t.id === active)
  return Array.from({ length: materialCount }, (_, m) => {
    if (materialCount === 1) return active
    const bound = textures.find((t) => t.materials.includes(m))
    if (bound) return bound.id
    return activeEntry && !activeEntry.materials.length && m === fallback ? activeEntry.id : null
  })
}

/**
 * The texture set picked (`fallback`) when no texture is drawn on it while the active texture is
 * bound to other materials: a bake then goes into a new texture for it. Null otherwise.
 */
export function unboundPick(materialCount: number, textures: readonly TextureEntry[], active: string | null, fallback: number): number | null {
  if (materialCount <= 1 || fallback < 0 || fallback >= materialCount) return null
  if (!textures.find((t) => t.id === active)?.materials.length) return null
  return textures.some((t) => t.materials.includes(fallback)) ? null : fallback
}

/** The materials the active texture is drawn on (and baked from). */
export function activeMaterials(materialCount: number, textures: readonly TextureEntry[], active: string | null, fallback: number): number[] {
  if (materialCount <= 1) return [0]
  const bound = textures.find((t) => t.id === active)?.materials
  return bound?.length ? bound : [Math.min(Math.max(fallback, 0), materialCount - 1)]
}

/** The textures on the shared stack. */
export function sharedTextures(textures: readonly TextureEntry[], docs: Docs): TextureEntry[] {
  return textures.filter((t) => !docs.separate[t.id])
}
