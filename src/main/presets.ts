// User presets live as files in <userData>/presets (per-user app data on every OS:
// %APPDATA% on Windows, ~/Library/Application Support on macOS, ~/.config on Linux).

import { app } from 'electron'
import { mkdir, readdir, rename, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'

export const PRESET_SUFFIX = '.pxlook'
/** Suffix presets had before; files with it are renamed when the folder is first read. */
const LEGACY_SUFFIX = '.4fxpreset'

let migrated: Promise<void> | null = null

/** Renames old preset files to the current suffix (skipping ones whose new name is taken). */
async function migrateLegacy(dir: string): Promise<void> {
  const files = await readdir(dir).catch(() => [] as string[])
  for (const file of files) {
    if (!file.toLowerCase().endsWith(LEGACY_SUFFIX)) continue
    const target = join(dir, file.slice(0, -LEGACY_SUFFIX.length) + PRESET_SUFFIX)
    const taken = await stat(target).then(
      () => true,
      () => false
    )
    if (!taken) await rename(join(dir, file), target).catch(() => undefined)
  }
}

export async function presetsDir(): Promise<string> {
  const dir = join(app.getPath('userData'), 'presets')
  await mkdir(dir, { recursive: true })
  migrated ??= migrateLegacy(dir)
  await migrated
  return dir
}

/** Full path of a preset file; rejects anything that isn't a plain preset file name. */
export async function presetPath(file: string): Promise<string> {
  if (
    typeof file !== 'string' ||
    basename(file) !== file ||
    /[<>:"/\\|?*\u0000-\u001f]/.test(file) ||
    !file.toLowerCase().endsWith(PRESET_SUFFIX)
  ) {
    throw new Error(`Invalid preset file name "${String(file)}"`)
  }
  return join(await presetsDir(), file)
}
