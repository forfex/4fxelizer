// File names for exporting every texture into one folder (main checks them before writing).

import { EXPORT_FILE_TYPES } from './api'

/** A plain file name (no folders, no characters Windows forbids) with an image extension the app exports. */
export function isExportFileName(name: string): boolean {
  if (!name || name.length > 200 || /[\\/:*?"<>|\u0000-\u001f]/.test(name) || /^\.+$/.test(name) || /[. ]$/.test(name)) return false
  const ext = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase()
  return !!ext && (EXPORT_FILE_TYPES as readonly string[]).includes(ext)
}

/** The same names, with " (2)", " (3)", … before the extension where two would clash (case-insensitive). */
export function uniqueFileNames(names: readonly string[]): string[] {
  const used = new Set<string>()
  return names.map((name) => {
    const dot = name.lastIndexOf('.')
    const stem = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ''
    let candidate = name
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${ext}`
    used.add(candidate.toLowerCase())
    return candidate
  })
}
