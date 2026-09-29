// Which files live reload watches, and what a changed one is to the open project (pure, tested).

import type { AppState } from './store'

export type Watched = Pick<AppState, 'liveReload' | 'textures' | 'model'>

/** The files to watch: every texture, the maps loaded from files, the model and its files; none when off. */
export function watchedPaths(s: Watched): string[] {
  if (!s.liveReload) return []
  const paths = [
    ...s.textures.flatMap((t) => [t.image.path, ...Object.values(t.maps).map((m) => (m.baked ? undefined : m.path))]),
    s.model?.path,
    ...(s.model?.path ? (s.model.resources ?? []) : [])
  ]
  return [...new Set(paths.filter((p): p is string => !!p))]
}

/**
 * What a changed file is to the open project: the textures loaded from it, whether it's a map of
 * one, whether it's the model or one of its files (one file can be several, e.g. a texture also
 * used as a map).
 */
export function changedRoles(s: Watched, path: string): { textures: string[]; map: boolean; model: boolean } {
  const same = (p: string | undefined): boolean => !!p && p === path
  return {
    textures: s.textures.filter((t) => same(t.image.path)).map((t) => t.id),
    map: s.textures.some((t) => Object.values(t.maps).some((m) => !m.baked && same(m.path))),
    model: same(s.model?.path) || (!!s.model?.path && (s.model.resources ?? []).includes(path))
  }
}
