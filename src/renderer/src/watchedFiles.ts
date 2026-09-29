// Which files live reload watches, and what a changed one is to the open project (pure, tested).

import type { AppState } from './store'

export type Watched = Pick<AppState, 'liveReload' | 'image' | 'maps' | 'model'>

/** The files to watch: the texture, the maps loaded from files, the model and its files; none when off. */
export function watchedPaths(s: Watched): string[] {
  if (!s.liveReload) return []
  const paths = [
    s.image?.path,
    ...Object.values(s.maps).map((m) => (m.baked ? undefined : m.path)),
    s.model?.path,
    ...(s.model?.path ? (s.model.resources ?? []) : [])
  ]
  return [...new Set(paths.filter((p): p is string => !!p))]
}

/** What a changed file is to the open project (one file can be several, e.g. a texture also used as a map). */
export function changedRoles(s: Watched, path: string): { texture: boolean; map: boolean; model: boolean } {
  const same = (p: string | undefined): boolean => !!p && p === path
  return {
    texture: same(s.image?.path),
    map: Object.values(s.maps).some((m) => !m.baked && same(m.path)),
    model: same(s.model?.path) || (!!s.model?.path && (s.model.resources ?? []).includes(path))
  }
}
