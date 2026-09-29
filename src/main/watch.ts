// Watches the files the renderer has open (texture, maps, model and the files it refers to) and
// reports when one changes on disk, so they reload live. Folders are watched rather than the files,
// because editors often save by writing a new file and renaming it over the old one, which a
// watcher on the file itself would lose. A change is reported once the file has stopped changing
// for a moment and its size or modification time differs from what was last seen.

import { watch, type FSWatcher } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

/** Quiet time (ms) after the last event before a file counts as saved. */
const SETTLE_MS = 300

/** Most files watched at once. */
export const MAX_WATCHED = 64

interface Signature {
  mtime: number
  size: number
}

async function signature(path: string): Promise<Signature | null> {
  try {
    const info = await stat(path)
    return info.isFile() ? { mtime: info.mtimeMs, size: info.size } : null
  } catch {
    return null
  }
}

/** Paths compare without case on Windows and macOS (their usual file systems ignore it). */
const key = (path: string): string => (process.platform === 'linux' ? path : path.toLowerCase())

export class FileWatcher {
  /** Watched files by key: path as given and its last seen signature. */
  private readonly files = new Map<string, { path: string; seen: Signature | null }>()
  private readonly folders = new Map<string, FSWatcher>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private generation = 0

  constructor(private readonly onChange: (path: string) => void) {}

  /** Replaces the watched files ([] stops watching). */
  async set(paths: unknown): Promise<void> {
    const generation = ++this.generation
    const wanted = new Map<string, string>()
    if (Array.isArray(paths)) {
      for (const p of paths) {
        if (typeof p === 'string' && isAbsolute(p) && wanted.size < MAX_WATCHED) wanted.set(key(resolve(p)), resolve(p))
      }
    }
    const added = [...wanted].filter(([k]) => !this.files.has(k))
    const seen = await Promise.all(added.map(([, path]) => signature(path)))
    if (generation !== this.generation) return // superseded while reading
    for (const k of [...this.files.keys()]) {
      if (!wanted.has(k)) {
        this.files.delete(k)
        clearTimeout(this.timers.get(k))
        this.timers.delete(k)
      }
    }
    added.forEach(([k, path], i) => this.files.set(k, { path, seen: seen[i]! }))

    const needed = new Set([...this.files.values()].map((f) => key(dirname(f.path))))
    for (const [k, watcher] of this.folders) {
      if (!needed.has(k)) {
        watcher.close()
        this.folders.delete(k)
      }
    }
    for (const file of this.files.values()) {
      const folder = dirname(file.path)
      if (this.folders.has(key(folder))) continue
      try {
        const watcher = watch(folder, (_event, name) => this.touched(folder, name ? name.toString() : null))
        watcher.on('error', () => {
          watcher.close()
          this.folders.delete(key(folder))
        })
        this.folders.set(key(folder), watcher)
      } catch {
        // The folder is gone or can't be watched: its files just don't reload.
      }
    }
  }

  /** Whether a path is being watched (only watched files may be read back). */
  has(path: unknown): boolean {
    return typeof path === 'string' && isAbsolute(path) && this.files.has(key(resolve(path)))
  }

  private touched(folder: string, name: string | null): void {
    // No name: something changed in the folder; check all its files.
    const keys = name
      ? [key(join(folder, basename(name)))]
      : [...this.files.values()].filter((f) => key(dirname(f.path)) === key(folder)).map((f) => key(f.path))
    for (const k of keys) {
      if (!this.files.has(k)) continue
      clearTimeout(this.timers.get(k))
      this.timers.set(
        k,
        setTimeout(() => {
          this.timers.delete(k)
          void this.check(k)
        }, SETTLE_MS)
      )
    }
  }

  private async check(k: string): Promise<void> {
    const file = this.files.get(k)
    if (!file) return
    const now = await signature(file.path)
    // Deleted (or mid-save): keep the old signature, so the file reloads when it's back.
    if (!now || this.files.get(k) !== file) return
    if (file.seen && now.mtime === file.seen.mtime && now.size === file.seen.size) return
    file.seen = now
    this.onChange(file.path)
  }

  dispose(): void {
    this.generation++
    for (const watcher of this.folders.values()) watcher.close()
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.folders.clear()
    this.timers.clear()
    this.files.clear()
  }
}
