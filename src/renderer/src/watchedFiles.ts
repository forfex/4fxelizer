// Which files live reload watches, and what a changed one is to the open project (pure, tested).

import type { AppState } from './store'
import type { TextureEntry } from './stack/textures'

export type Watched = Pick<AppState, 'liveReload' | 'textures' | 'model'>

/** The textures that reload (with their maps): all of them, the ones switched on, or none. */
function reloadingTextures(s: Watched): TextureEntry[] {
  if (s.liveReload === 'off') return []
  return s.liveReload === 'all' ? s.textures : s.textures.filter((t) => t.liveReload !== false)
}

/** The model's files, when it reloads. */
function reloadingModelFiles(s: Watched): string[] {
  const model = s.model
  if (!model?.path || s.liveReload === 'off' || (s.liveReload === 'per-file' && model.liveReload === false)) return []
  return [model.path, ...(model.resources ?? [])]
}

/** The files to watch: the reloading textures, their maps loaded from files, the model and its files. */
export function watchedPaths(s: Watched): string[] {
  const paths = [
    ...reloadingTextures(s).flatMap((t) => [t.image.path, ...Object.values(t.maps).map((m) => (m.baked ? undefined : m.path))]),
    ...reloadingModelFiles(s)
  ]
  return [...new Set(paths.filter((p): p is string => !!p))]
}

/**
 * What a changed file is to the open project, among what reloads: the textures loaded from it,
 * the textures with a map loaded from it, whether it's the model or one of its files (one file can
 * be several, e.g. a texture also used as a map).
 */
export function changedRoles(s: Watched, path: string): { textures: string[]; maps: string[]; model: boolean } {
  const textures = reloadingTextures(s)
  return {
    textures: textures.filter((t) => t.image.path === path).map((t) => t.id),
    maps: textures.filter((t) => Object.values(t.maps).some((m) => !m.baked && m.path === path)).map((t) => t.id),
    model: reloadingModelFiles(s).includes(path)
  }
}
