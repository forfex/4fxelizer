// File › Open Recent: the projects, textures and models opened last, newest first. The list is a
// user setting (`recentFiles`); the menu shows it as `recent-0` … commands, and main only reads
// files that are on it.

export const MAX_RECENT = 10

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/** The list with `paths` moved (or added) to the front, the first of them first. */
export function addRecent(list: readonly string[], paths: readonly string[]): string[] {
  const out: string[] = []
  for (const path of [...paths, ...list]) {
    if (path && !out.some((p) => same(p, path))) out.push(path)
  }
  return out.slice(0, MAX_RECENT)
}

export function removeRecent(list: readonly string[], path: string): string[] {
  return list.filter((p) => !same(p, path))
}

/** A stored list, kept to non-empty strings without repeats. */
export function normalizeRecent(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return addRecent([], raw.filter((p): p is string => typeof p === 'string' && p.trim() !== ''))
}

/** Menu label: the file's name and the folder it is in ("rock.png — textures"). */
export function recentLabel(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  const name = parts[parts.length - 1] ?? path
  const folder = parts[parts.length - 2]
  return folder ? `${name} — ${folder}` : name
}
