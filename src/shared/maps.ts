// Imported map slots (AO, cavity, …) and how map files are recognized by name. Shared by main
// (finding a texture's sibling maps on disk) and the renderer (assigning dropped files to slots).

export const MAP_SLOTS = [
  { id: 'ao', label: 'Ambient occlusion', short: 'AO', hint: 'Dark where light is blocked: crevices, contact shadows.' },
  { id: 'cavity', label: 'Cavity', short: 'Cavity', hint: 'Dark in small crevices and scratches.' },
  { id: 'curvature', label: 'Curvature', short: 'Curvature', hint: 'Bright on convex edges, dark in concave areas, gray on flats.' },
  { id: 'edge', label: 'Edge', short: 'Edge', hint: 'Bright on convex edges (wear, highlights).' },
  { id: 'thickness', label: 'Thickness', short: 'Thickness', hint: 'Bright where the model is thick.' },
  { id: 'height', label: 'Height', short: 'Height', hint: 'Bright where the surface is high.' },
  { id: 'roughness', label: 'Roughness', short: 'Roughness', hint: 'Bright where the surface is rough.' },
  { id: 'metallic', label: 'Metallic', short: 'Metallic', hint: 'Bright where the surface is metal.' }
] as const

export type MapSlot = (typeof MAP_SLOTS)[number]['id']

/** Which part of a map image is the mask: brightness, or one channel (packed maps such as ORM). */
export const MAP_CHANNELS = [
  { id: 'luma', label: 'Gray', hint: 'Brightness of the image.' },
  { id: 'r', label: 'R', hint: 'Red channel.' },
  { id: 'g', label: 'G', hint: 'Green channel.' },
  { id: 'b', label: 'B', hint: 'Blue channel.' },
  { id: 'a', label: 'A', hint: 'Alpha channel.' }
] as const

export type MapChannel = (typeof MAP_CHANNELS)[number]['id']

export interface MapAssignment {
  slot: MapSlot
  channel: MapChannel
}

export const MAP_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tga']

/** File name suffixes (lowercase, separators removed) and the slots they fill. */
const SUFFIXES: [string[], MapAssignment[]][] = [
  // Channel-packed maps first, so "occlusionroughnessmetallic" isn't read as plain AO.
  [['orm', 'occlusionroughnessmetallic', 'arm', 'aorm'], [{ slot: 'ao', channel: 'r' }, { slot: 'roughness', channel: 'g' }, { slot: 'metallic', channel: 'b' }]],
  [['rma', 'roughnessmetallicao', 'roughnessmetallicocclusion'], [{ slot: 'roughness', channel: 'r' }, { slot: 'metallic', channel: 'g' }, { slot: 'ao', channel: 'b' }]],
  [['ao', 'ambientocclusion', 'occlusion', 'occ', 'mixedao'], [{ slot: 'ao', channel: 'luma' }]],
  [['cavity', 'cav'], [{ slot: 'cavity', channel: 'luma' }]],
  [['curvature', 'curv'], [{ slot: 'curvature', channel: 'luma' }]],
  [['edge', 'edges', 'convexity', 'wear'], [{ slot: 'edge', channel: 'luma' }]],
  [['thickness', 'thick'], [{ slot: 'thickness', channel: 'luma' }]],
  [['height', 'heightmap', 'disp', 'displacement', 'bump'], [{ slot: 'height', channel: 'luma' }]],
  [['roughness', 'rough', 'rgh'], [{ slot: 'roughness', channel: 'luma' }]],
  [['metallic', 'metalness', 'metal', 'mtl'], [{ slot: 'metallic', channel: 'luma' }]]
]

/** Suffixes of color textures, dropped when matching a texture with its maps. */
const COLOR_SUFFIXES = ['albedo', 'basecolor', 'basecolour', 'diffuse', 'diff', 'color', 'colour', 'col', 'alb', 'base', 'bc', 'd']

const SEPARATOR = /[_\-. ]+/

function stem(fileName: string): string {
  const name = fileName.split(/[\\/]/).pop() ?? fileName
  return name.replace(/\.[^.]+$/, '')
}

/** Name without extension split at separators and camel case, lowercased: "Rock_AmbientOcclusion" → ["rock", "ambient", "occlusion"]. */
function words(fileName: string): string[] {
  return stem(fileName)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .split(SEPARATOR)
    .filter(Boolean)
    .map((w) => w.toLowerCase())
}

/**
 * Longest run of trailing words that spells one of `suffixes` (words joined without separators),
 * so "rock_mixed_AO", "rock-ambient-occlusion" and "RockAmbientOcclusion" all match.
 */
function trailingMatch(ws: string[], suffixes: string[]): number {
  for (let n = Math.min(ws.length - 1, 4); n >= 1; n--) {
    if (suffixes.includes(ws.slice(-n).join(''))) return n
  }
  return 0
}

/** The map slots a file fills, judged by its name, and the texture name it belongs to; null = not a map. */
export function detectMap(fileName: string): { base: string; maps: MapAssignment[] } | null {
  const ws = words(fileName)
  for (const [suffixes, maps] of SUFFIXES) {
    const n = trailingMatch(ws, suffixes)
    if (n) return { base: ws.slice(0, -n).join('_'), maps }
  }
  return null
}

/** Name a texture's maps share with it: "Rock_BaseColor.png" → "rock". */
export function textureBase(fileName: string): string {
  const ws = words(fileName)
  const n = trailingMatch(ws, COLOR_SUFFIXES)
  return ws.slice(0, ws.length - n).join('_')
}

export function isImageFile(fileName: string): boolean {
  const ext = /\.([^.]+)$/.exec(fileName)?.[1]?.toLowerCase()
  return !!ext && MAP_IMAGE_EXTENSIONS.includes(ext)
}

/** Files among `fileNames` that are maps of `textureName` (same base name, a map suffix). */
export function siblingMaps(textureName: string, fileNames: string[]): string[] {
  const base = textureBase(textureName)
  const self = stem(textureName).toLowerCase()
  return fileNames.filter((f) => {
    if (!isImageFile(f) || stem(f).toLowerCase() === self) return false
    const map = detectMap(f)
    return !!map && map.base === base
  })
}
