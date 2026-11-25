// File › Process Folder: which files of a folder are textures to process.

import { detectMap, isImageFile, textureBase } from './maps'

/** Ending of the files the app exports ("rock_4fx.png"); processing a folder twice skips them. */
export const EXPORT_SUFFIX = '_4fx'

const stem = (name: string): string => name.replace(/\.[^.]+$/, '')

/**
 * The textures among a folder's file names, sorted: images, without the app's own exports and
 * without map files (rock_ao.png) that sit next to the texture they belong to.
 */
export function batchInputs(names: readonly string[]): string[] {
  const images = names.filter((n) => isImageFile(n) && !stem(n).toLowerCase().endsWith(EXPORT_SUFFIX))
  const bases = new Set(images.filter((n) => !detectMap(n)).map((n) => textureBase(n)))
  return images
    .filter((n) => {
      const map = detectMap(n)
      return !map || !bases.has(map.base)
    })
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
}

/** Name of the file a texture is exported as. */
export function batchOutputName(name: string, extension: string): string {
  return `${stem(name)}${EXPORT_SUFFIX}.${extension}`
}
