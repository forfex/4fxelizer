// User presets live as files in <userData>/presets (per-user app data on every OS:
// %APPDATA% on Windows, ~/Library/Application Support on macOS, ~/.config on Linux).

import { app } from 'electron'
import { mkdir } from 'node:fs/promises'
import { basename, join } from 'node:path'

export const PRESET_SUFFIX = '.4fxpreset'

export async function presetsDir(): Promise<string> {
  const dir = join(app.getPath('userData'), 'presets')
  await mkdir(dir, { recursive: true })
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
