// Project files (.pxproj): the document plus the files it was made with (texture, maps, model),
// referenced by path. Paths are stored absolute and relative to the project file, so a project
// still opens after its folder is moved or copied to another machine together with its files.

export const PROJECT_EXTENSION = 'pxproj'
export const PROJECT_SUFFIX = `.${PROJECT_EXTENSION}`

/** A file a project refers to. */
export interface ProjectFileRef {
  /** Absolute path when it was saved. */
  path: string
  /** Path relative to the project file's folder, '/'-separated (absent when on another drive). */
  relative?: string
}

export const isProjectFile = (name: string): boolean => name.toLowerCase().endsWith(PROJECT_SUFFIX)

interface SplitPath {
  /** "c:", "//server/share", "/" … ('' for a relative path). */
  root: string
  parts: string[]
  /** Windows-style root: compare case-insensitively. */
  windows: boolean
}

function splitPath(path: string): SplitPath {
  const p = path.replace(/\\/g, '/')
  let root = ''
  let rest = p
  let windows = false
  const drive = /^([a-zA-Z]:)(\/|$)/.exec(p)
  const unc = /^\/\/([^/]+)\/([^/]+)/.exec(p)
  if (drive) {
    root = drive[1]!.toLowerCase()
    rest = p.slice(drive[0].length)
    windows = true
  } else if (unc) {
    root = `//${unc[1]}/${unc[2]}`.toLowerCase()
    rest = p.slice(unc[0].length)
    windows = true
  } else if (p.startsWith('/')) {
    root = '/'
    rest = p.slice(1)
  }
  const parts: string[] = []
  for (const part of rest.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return { root, parts, windows }
}

/** The folder part of a path ("C:\a\b.png" → "C:\a"). */
export function dirName(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i <= 0 ? path.slice(0, i + 1) : path.slice(0, i)
}

/** The file name part of a path. */
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/**
 * `to` relative to the folder `fromDir`, '/'-separated; null when they have no common root
 * (another drive or share) or either isn't absolute.
 */
export function relativePath(fromDir: string, to: string): string | null {
  const a = splitPath(fromDir)
  const b = splitPath(to)
  if (!a.root || a.root !== b.root) return null
  const same = (x: string, y: string): boolean => (a.windows ? x.toLowerCase() === y.toLowerCase() : x === y)
  let common = 0
  while (common < a.parts.length && common < b.parts.length && same(a.parts[common]!, b.parts[common]!)) common++
  const up = a.parts.length - common
  const rel = [...Array<string>(up).fill('..'), ...b.parts.slice(common)].join('/')
  return rel || '.'
}

/** A reference to `path` as stored in a project saved at `projectPath`. */
export function fileRef(projectPath: string, path: string): ProjectFileRef {
  const relative = relativePath(dirName(projectPath), path)
  return relative ? { path, relative } : { path }
}
