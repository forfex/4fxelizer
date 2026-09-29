import type { ExportFileType, ExportFormat, FileFilter, MenuCommand, OpenedFile, Theme, ViewMode } from '@shared/api'
import { detectMap, MAP_IMAGE_EXTENSIONS, mapFileName, MAP_SLOTS, type MapChannel, type MapSlot } from '@shared/maps'
import { isModelFile } from '@shared/model'
import { isProjectFile } from '@shared/project'
import type { View3dLookChoice } from '@shared/view3d'
import { encodePattern, patternFromRgba } from '@/dither/customPattern'
import { getEngine } from '@/engine'
import type { DitherParams } from '@/gpu/passes/dither'
import { readTextureRgba8 } from '@/gpu/textureIO'
import { decodeImage } from '@/image/decode'
import { bmpBitDepth, encodeBmp, encodeIndexedBmp } from '@/image/bmp'
import { countColors, hasTranslucency, hasTransparency, toIndexed } from '@/image/indexed'
import { encodeIndexedPng, encodePng, indexedBitDepth, type IndexedImage, type RgbaImage } from '@/image/png'
import { psxStats, type PsxStats } from '@/image/psx'
import { encodeIndexedTga, encodeTga } from '@/image/tga'
import { exportPalette, parsePaletteFile, type PaletteExportFormat } from '@/palette/formats'
import { applyPick, MAX_PALETTE, rgb8ToHex, type Palette } from '@/palette/palette'
import { loadModelFile, openModel } from '@/modelActions'
import { openProject, openProjectFile, saveProject } from '@/projectActions'
import { BUILTIN_PRESETS, type BuiltinPreset } from '@/stack/builtinPresets'
import { LEGACY_PRESET_EXTENSION, parsePreset, PRESET_EXTENSION, presetFileName, serializePreset, type ParsedPreset } from '@/stack/preset'
import { useApp, type MapInfo } from '@/store'

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export const PALETTE_EXTENSIONS = ['hex', 'gpl', 'pal', 'act', 'ase', 'txt']
const PALETTE_FILTERS: FileFilter[] = [{ name: 'Palettes', extensions: PALETTE_EXTENSIONS }]

/**
 * Opens a texture. Its maps (AO, cavity, … named like it, e.g. rock_ao.png next to rock.png) are
 * loaded too when the file's path is known; the previous texture's maps are dropped (maps baked
 * from the model stay: they belong to the model's UVs).
 */
export async function loadImageFile(name: string, bytes: Uint8Array, path?: string, opts: { findMaps?: boolean } = {}): Promise<void> {
  const engine = getEngine()
  const { setMessage, setImage } = useApp.getState()
  if (!engine) return
  try {
    const bitmap = await decodeImage(name, bytes)
    engine.loadBitmap(bitmap)
    setImage({ name, width: bitmap.width, height: bitmap.height, path })
    bitmap.close()
    clearMaps({ keepBaked: true })
    const maps = path && opts.findMaps !== false ? await window.fx.findMaps(path).catch(() => []) : []
    const loaded = maps.length ? await importMapFiles(maps, { quiet: true }) : []
    setMessage({ kind: 'info', text: loaded.length ? `Loaded ${name} with its ${mapList(loaded)} maps` : `Loaded ${name}` })
  } catch (e) {
    setMessage({ kind: 'error', text: errorText(e) })
  }
}

/**
 * The open texture changed on disk: loads it again in place. The stack, the maps and (when the
 * size is unchanged) the zoom stay.
 */
export async function reloadImageFile(file: OpenedFile): Promise<void> {
  const engine = getEngine()
  const { setMessage, setImage } = useApp.getState()
  if (!engine) return
  try {
    const bitmap = await decodeImage(file.name, file.bytes)
    engine.loadBitmap(bitmap)
    setImage({ name: file.name, width: bitmap.width, height: bitmap.height, path: file.path }, { keepView: true })
    bitmap.close()
    setMessage({ kind: 'info', text: `Reloaded ${file.name}` })
  } catch (e) {
    setMessage({ kind: 'error', text: `Couldn't reload ${file.name}: ${errorText(e)}` })
  }
}

export async function openImage(): Promise<void> {
  const file = await window.fx.openImage()
  if (file) await loadImageFile(file.name, file.bytes, file.path)
}

const extensionOf = (name: string): string => /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? ''

/**
 * Dropped files: models open in the 3D view, presets load, palette files become palettes, images
 * open as the texture. Images named like maps (rock_ao.png) fill map slots instead when a texture
 * is open or comes with them.
 */
export async function openDroppedFiles(files: OpenedFile[]): Promise<void> {
  // A project replaces everything, so it opens alone.
  const project = files.find((f) => isProjectFile(f.name))
  if (project) return openProjectFile(project)
  const images: OpenedFile[] = []
  const model = files.find((f) => isModelFile(f.name))
  if (model) await loadModelFile(model.name, model.bytes, model.path)
  for (const file of files) {
    const ext = extensionOf(file.name)
    if (file === model || isModelFile(file.name)) continue
    if (ext === PRESET_EXTENSION || ext === LEGACY_PRESET_EXTENSION) loadPresetJson(new TextDecoder().decode(file.bytes), file.name)
    else if (PALETTE_EXTENSIONS.includes(ext) && ext !== 'txt') importPaletteBytes(file.name, file.bytes)
    else images.push(file)
  }
  if (!images.length) return
  const maps = images.filter((f) => detectMap(f.name))
  const texture = images.find((f) => !detectMap(f.name)) ?? (useApp.getState().image ? undefined : images[0])
  if (texture) await loadImageFile(texture.name, texture.bytes, texture.path)
  const dropped = maps.filter((f) => f !== texture)
  if (dropped.length) {
    const loaded = await importMapFiles(dropped, { quiet: true })
    if (loaded.length) {
      const image = useApp.getState().image
      useApp.getState().setMessage({ kind: 'info', text: `Loaded the ${mapList(loaded)} maps${texture && image ? ` for ${image.name}` : ''}` })
    }
  }
}

// ── Custom dither patterns ─────────────────────────────────────────────────

/** Asks for a small image to use as a dither pattern and stores it in a Dither stage. */
export async function loadPatternImage(uid: string): Promise<void> {
  const { setMessage } = useApp.getState()
  const file = await window.fx.openFile([{ name: 'Images', extensions: MAP_IMAGE_EXTENSIONS }])
  if (!file) return
  try {
    const bitmap = await decodeImage(file.name, file.bytes)
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not read the image.')
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const pattern = patternFromRgba({ width, height, data: new Uint8Array(data.buffer) })
    useApp.getState().updateParams<DitherParams>(uid, { customPattern: encodePattern(pattern), customPatternName: file.name })
    setMessage({ kind: 'info', text: `Using ${file.name} (${width}×${height}) as the dither pattern` })
  } catch (e) {
    setMessage({ kind: 'error', text: `Couldn't use ${file.name} as a pattern: ${errorText(e)}` })
  }
}

// ── Maps ───────────────────────────────────────────────────────────────────

let mapVersion = 0

const mapLabel = (slot: MapSlot): string => MAP_SLOTS.find((m) => m.id === slot)?.short ?? slot
const mapList = (slots: MapSlot[]): string => [...new Set(slots)].map(mapLabel).join(', ')

/** A small preview of a map for the Maps panel. */
export function thumbnail(bitmap: ImageBitmap, side = 48): string | null {
  const canvas = document.createElement('canvas')
  const scale = side / Math.max(bitmap.width, bitmap.height)
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL()
}

/** Decodes a map image once and puts it into each slot it fills. `baked`: it was baked from the model (projects store those). */
export async function loadMapInto(
  assignments: { slot: MapSlot; channel: MapChannel }[],
  name: string,
  bytes: Uint8Array,
  path?: string,
  opts: { baked?: boolean } = {}
): Promise<void> {
  const engine = getEngine()
  if (!engine) throw new Error('The GPU is not ready.')
  const bitmap = await decodeImage(name, bytes)
  try {
    const thumb = thumbnail(bitmap)
    for (const { slot, channel } of assignments) {
      const version = ++mapVersion
      engine.loadMap(slot, bitmap, version)
      useApp.getState().setMap(slot, { name, width: bitmap.width, height: bitmap.height, channel, version, thumbnail: thumb, path, ...(opts.baked ? { baked: true } : {}) })
    }
  } finally {
    bitmap.close()
  }
}

/**
 * Loads map files into the slots their names point to (rock_ao.png → AO; rock_orm.png → AO,
 * roughness and metallic from its channels). Returns the slots filled.
 */
export async function importMapFiles(files: OpenedFile[], opts: { quiet?: boolean } = {}): Promise<MapSlot[]> {
  const { setMessage } = useApp.getState()
  const filled: MapSlot[] = []
  const unknown: string[] = []
  // Packed maps (ORM) first, so a dedicated map for the same slot (rock_ao.png) wins.
  const packedFirst = [...files].sort((a, b) => (detectMap(b.name)?.maps.length ?? 0) - (detectMap(a.name)?.maps.length ?? 0))
  for (const file of packedFirst) {
    const detected = detectMap(file.name)
    if (!detected) {
      unknown.push(file.name)
      continue
    }
    try {
      await loadMapInto(detected.maps, file.name, file.bytes, file.path)
      filled.push(...detected.maps.map((m) => m.slot))
    } catch (e) {
      setMessage({ kind: 'error', text: `Couldn't load ${file.name}: ${errorText(e)}` })
      return filled
    }
  }
  if (unknown.length) {
    setMessage({
      kind: 'error',
      text: `Couldn't tell which map ${unknown.join(', ')} is. Name maps like rock_ao.png, or load them from the Maps panel.`
    })
  } else if (!opts.quiet && filled.length) {
    setMessage({ kind: 'info', text: `Loaded the ${mapList(filled)} maps` })
  }
  return filled
}

/** Loads a map into one slot from a file dialog. A packed map (ORM) keeps the channel its name implies. */
export async function openMapFile(slot: MapSlot): Promise<void> {
  const file = await window.fx.openFile([{ name: 'Images', extensions: MAP_IMAGE_EXTENSIONS }])
  if (!file) return
  const channel = detectMap(file.name)?.maps.find((m) => m.slot === slot)?.channel ?? 'luma'
  try {
    await loadMapInto([{ slot, channel }], file.name, file.bytes, file.path)
    useApp.getState().setMessage({ kind: 'info', text: `Loaded ${file.name} as the ${mapLabel(slot)} map` })
  } catch (e) {
    useApp.getState().setMessage({ kind: 'error', text: `Couldn't load ${file.name}: ${errorText(e)}` })
  }
}

/** A map file changed on disk: loads it again into every slot still filled from it (same channels). */
export async function reloadMapFile(file: OpenedFile): Promise<void> {
  const slots = (Object.entries(useApp.getState().maps) as [MapSlot, MapInfo][]).filter(([, m]) => m.path && m.path === file.path && !m.baked)
  if (!slots.length) return
  try {
    await loadMapInto(slots.map(([slot, m]) => ({ slot, channel: m.channel })), file.name, file.bytes, file.path)
    useApp.getState().setMessage({ kind: 'info', text: `Reloaded ${file.name}` })
  } catch (e) {
    useApp.getState().setMessage({ kind: 'error', text: `Couldn't reload ${file.name}: ${errorText(e)}` })
  }
}

export function clearMap(slot: MapSlot): void {
  getEngine()?.loadMap(slot, null, ++mapVersion)
  useApp.getState().setMap(slot, null)
}

/** Removes the loaded maps (all, or all but the ones baked from the model). */
export function clearMaps(opts: { keepBaked?: boolean; onlyBaked?: boolean } = {}): void {
  const { maps, setMap } = useApp.getState()
  for (const [slot, map] of Object.entries(maps) as [MapSlot, MapInfo][]) {
    if ((opts.keepBaked && map.baked) || (opts.onlyBaked && !map.baked)) continue
    getEngine()?.loadMap(slot, null, ++mapVersion)
    setMap(slot, null)
  }
}

/** Saves a map as a grayscale PNG named so it loads with the texture next time (rock_ao.png). */
export async function saveMap(slot: MapSlot): Promise<void> {
  const engine = getEngine()
  const { image, model, setMessage } = useApp.getState()
  const texture = engine?.mapTexture(slot)
  if (!engine || !texture) return
  try {
    const rgba = await readTextureRgba8(engine.gpu.device, texture)
    const name = mapFileName(image?.name ?? model?.name ?? 'texture', slot)
    const path = await window.fx.saveFile(name, await encodePng(rgba), [ENCODERS.png.filter])
    if (path) setMessage({ kind: 'info', text: `Saved ${path}` })
  } catch (e) {
    setMessage({ kind: 'error', text: `Couldn't save the ${mapLabel(slot)} map: ${errorText(e)}` })
  }
}

/** A new, unique map version (cached stages reading a map re-run when it changes). */
export const nextMapVersion = (): number => ++mapVersion

export type { ExportFormat }

export interface ExportOptions {
  format: ExportFormat
  /** Indexed only: palette whose order and colors become the file's palette; null = the image's colors. */
  paletteId: string | null
}

interface Encoder {
  label: string
  filter: FileFilter
  rgba(image: RgbaImage): Uint8Array | Promise<Uint8Array>
  indexed(image: IndexedImage): Uint8Array | Promise<Uint8Array>
  /** Bits per pixel for an indexed image with `count` palette entries. */
  indexedDepth(count: number): number
  /** Whether an indexed file's palette stores alpha. */
  indexedAlpha: boolean
}

export const ENCODERS: Record<ExportFileType, Encoder> = {
  png: { label: 'PNG', filter: { name: 'PNG image', extensions: ['png'] }, rgba: encodePng, indexed: encodeIndexedPng, indexedDepth: indexedBitDepth, indexedAlpha: true },
  tga: { label: 'TGA', filter: { name: 'TGA image', extensions: ['tga'] }, rgba: encodeTga, indexed: encodeIndexedTga, indexedDepth: () => 8, indexedAlpha: true },
  bmp: { label: 'BMP', filter: { name: 'BMP image', extensions: ['bmp'] }, rgba: encodeBmp, indexed: encodeIndexedBmp, indexedDepth: bmpBitDepth, indexedAlpha: false }
}

export function parseExportFormat(format: ExportFormat): { type: ExportFileType; indexed: boolean } {
  const [type, mode] = format.split('-') as [ExportFileType, string]
  return { type, indexed: mode === 'indexed' }
}

const baseName = (): string => useApp.getState().image?.name.replace(/\.[^.]+$/, '') ?? 'texture'

/** What an export would produce, for the export dialog. */
export interface OutputSummary {
  width: number
  height: number
  /** Distinct colors (all fully transparent pixels count as one); stops counting at 257. */
  colors: number
  /** Like `colors`, but colors that differ only in alpha count once (for palettes without alpha). */
  opaqueColors: number
  transparent: boolean
  /** Some pixels are semi-transparent. */
  translucent: boolean
  psx: PsxStats
}

export async function describeOutput(): Promise<OutputSummary | null> {
  const engine = getEngine()
  if (!engine || !useApp.getState().image) return null
  const image = await engine.readOutput()
  return {
    width: image.width,
    height: image.height,
    colors: countColors(image),
    opaqueColors: countColors(image, 257, false),
    transparent: hasTransparency(image),
    translucent: hasTranslucency(image),
    psx: psxStats(image)
  }
}

/** Returns true when the file was written. */
export async function exportImage(options: ExportOptions): Promise<boolean> {
  const engine = getEngine()
  const { image, palettes, setMessage } = useApp.getState()
  if (!engine || !image) return false
  try {
    const rgba = await engine.readOutput()
    const { type, indexed } = parseExportFormat(options.format)
    const encoder = ENCODERS[type]
    let bytes: Uint8Array
    let detail: string
    if (indexed) {
      const palette = options.paletteId ? palettes.find((p) => p.id === options.paletteId) : undefined
      const image = toIndexed(rgba, palette?.colors.map((c) => c.hex), { alpha: encoder.indexedAlpha })
      bytes = await encoder.indexed(image)
      detail = `${image.palette.length} colors, ${encoder.indexedDepth(image.palette.length)}-bit indexed`
    } else {
      bytes = await encoder.rgba(rgba)
      detail = 'RGBA'
    }
    const path = await window.fx.saveFile(`${baseName()}_4fx.${encoder.filter.extensions[0]}`, bytes, [encoder.filter])
    if (!path) return false
    setMessage({ kind: 'info', text: `Saved ${path} (${rgba.width}×${rgba.height}, ${detail})` })
    return true
  } catch (e) {
    setMessage({ kind: 'error', text: `Export failed: ${errorText(e)}` })
    return false
  }
}

function importPaletteBytes(name: string, bytes: Uint8Array): void {
  const { addPalette, setMessage } = useApp.getState()
  try {
    const parsed = parsePaletteFile(name, bytes)
    addPalette({ name: parsed.name || name.replace(/\.[^.]+$/, ''), colors: parsed.colors.map((hex) => ({ hex })) })
    setMessage({ kind: 'info', text: `Imported ${parsed.colors.length} colors from ${name}` })
  } catch (e) {
    setMessage({ kind: 'error', text: `Palette import failed: ${errorText(e)}` })
  }
}

export async function importPalette(): Promise<void> {
  const file = await window.fx.openFile(PALETTE_FILTERS)
  if (file) importPaletteBytes(file.name, file.bytes)
}

export async function savePalette(id: string, format: PaletteExportFormat): Promise<void> {
  const { palettes, setMessage } = useApp.getState()
  const palette = palettes.find((p) => p.id === id)
  if (!palette) return
  const bytes = exportPalette(palette.name, palette.colors.map((c) => c.hex), format)
  const safe = palette.name.replace(/[^\w.-]+/g, '_') || 'palette'
  const path = await window.fx.saveFile(`${safe}.${format}`, bytes, [{ name: `.${format} palette`, extensions: [format] }])
  if (path) setMessage({ kind: 'info', text: `Saved ${path}` })
}

/** Replaces a palette's colors with the distinct colors of the current output (≤ 256). */
export async function extractPaletteFromOutput(id: string): Promise<void> {
  const engine = getEngine()
  const { updatePalette, setMessage } = useApp.getState()
  if (!engine || !useApp.getState().image) return
  try {
    const image = await engine.readOutput()
    const seen = new Set<string>()
    for (let i = 0; i < image.data.length; i += 4) {
      if (image.data[i + 3] === 0) continue
      seen.add(rgb8ToHex(image.data[i]!, image.data[i + 1]!, image.data[i + 2]!))
      if (seen.size > MAX_PALETTE) {
        throw new Error(`The output has more than ${MAX_PALETTE} colors. Reduce colors first, or use Generate.`)
      }
    }
    updatePalette(id, { colors: [...seen].sort().map((hex) => ({ hex })) })
    setMessage({ kind: 'info', text: `Extracted ${seen.size} colors from the output` })
  } catch (e) {
    setMessage({ kind: 'error', text: errorText(e) })
  }
}

/** The palette shown in the palette panel (the selected one, else the first). */
export function shownPalette(): Palette | undefined {
  const { palettes, selectedPaletteId } = useApp.getState()
  return palettes.find((p) => p.id === selectedPaletteId) ?? palettes[0]
}

/**
 * Eyedropper: picks the color the viewer shows at `uv` (0–1 across the image) on one side of the
 * split into the shown palette. Replaces the selected color (which stays selected), or else adds a
 * new one without selecting it, so repeated picks keep adding colors.
 */
export async function pickColor(side: 'before' | 'after', uv: { u: number; v: number }): Promise<void> {
  const engine = getEngine()
  const { setMessage } = useApp.getState()
  if (!engine || !useApp.getState().image) return
  if (side === 'after' && useApp.getState().maskUid) {
    setMessage({ kind: 'error', text: 'The viewer shows a stage mask; turn the mask view off to pick colors.' })
    return
  }
  try {
    const [r, g, b, a] = await engine.readShownPixel(side, uv)
    if (a === 0) {
      setMessage({ kind: 'error', text: 'That pixel is fully transparent; pick a visible one.' })
      return
    }
    const palette = shownPalette()
    if (!palette) {
      setMessage({ kind: 'error', text: 'Create a palette first (palette panel › ⋯ › New empty).' })
      return
    }
    const hex = rgb8ToHex(r, g, b)
    const { selectedColor, updatePalette, selectColor } = useApp.getState()
    // An undo can leave the selection past the end of the palette; then the pick adds a color.
    const index = selectedColor?.paletteId === palette.id && selectedColor.index < palette.colors.length ? selectedColor.index : null
    const result = applyPick(palette.colors, hex, index, !!palette.generator)
    if (!result) {
      setMessage({ kind: 'error', text: `"${palette.name}" is full (${MAX_PALETTE} colors).` })
      return
    }
    if (result.colors !== palette.colors) updatePalette(palette.id, { colors: result.colors }, { coalesce: undefined })
    if (index !== null) selectColor({ paletteId: palette.id, index })
    const text =
      index !== null
        ? `Replaced color ${index} with ${hex}`
        : result.index < palette.colors.length
          ? `${hex} is already color ${result.index}${result.colors !== palette.colors ? ' (now locked)' : ''}`
          : palette.generator
            ? `Added ${hex} as a locked color (regenerating fills the rest)`
            : `Added ${hex} as color ${result.index}`
    setMessage({ kind: 'info', text: `${text} in "${palette.name}"` })
  } catch (e) {
    setMessage({ kind: 'error', text: `Couldn't pick a color: ${errorText(e)}` })
  }
}

// ── Presets ────────────────────────────────────────────────────────────────

const PRESET_FILTERS: FileFilter[] = [{ name: '4FXELIZER preset', extensions: [PRESET_EXTENSION, LEGACY_PRESET_EXTENSION] }]
/** Saving offers only the current extension. */
const PRESET_SAVE_FILTERS: FileFilter[] = [{ name: '4FXELIZER preset', extensions: [PRESET_EXTENSION] }]

function applyPreset({ name, doc, warnings }: ParsedPreset): void {
  const app = useApp.getState()
  app.loadDoc(doc)
  app.setPresetName(name)
  app.setMessage(
    warnings.length
      ? { kind: 'error', text: `Loaded preset "${name}" with problems: ${warnings.join(' ')}` }
      : { kind: 'info', text: `Loaded preset "${name}"` }
  )
}

function loadPresetJson(json: string, source: string): void {
  try {
    applyPreset(parsePreset(json))
  } catch (e) {
    useApp.getState().setMessage({ kind: 'error', text: `Couldn't load ${source}: ${errorText(e)}` })
  }
}

export function loadBuiltinPreset(preset: BuiltinPreset): void {
  // Built-ins go through the same serializer/parser as files, so ids are fresh every time.
  loadPresetJson(serializePreset(preset.build(), preset.name), preset.name)
}

export async function loadUserPreset(file: string): Promise<void> {
  try {
    loadPresetJson(await window.fx.readPreset(file), file)
  } catch (e) {
    useApp.getState().setMessage({ kind: 'error', text: `Couldn't read preset: ${errorText(e)}` })
  }
}

/** Saves the current stack as a user preset. Returns false when the name exists and `overwrite` isn't set. */
export async function saveUserPreset(name: string, overwrite = false): Promise<boolean> {
  const app = useApp.getState()
  const file = presetFileName(name)
  const existing = await window.fx.listPresets()
  if (!overwrite && existing.some((p) => p.file.toLowerCase() === file.toLowerCase())) return false
  try {
    await window.fx.writePreset(file, serializePreset(app, name))
    app.setPresetName(name)
    app.presetsChanged()
    app.setMessage({ kind: 'info', text: `Saved preset "${name}"` })
  } catch (e) {
    app.setMessage({ kind: 'error', text: `Couldn't save preset: ${errorText(e)}` })
  }
  return true
}

export async function deleteUserPreset(file: string): Promise<void> {
  const app = useApp.getState()
  try {
    await window.fx.deletePreset(file)
    app.presetsChanged()
  } catch (e) {
    app.setMessage({ kind: 'error', text: `Couldn't delete preset: ${errorText(e)}` })
  }
}

export async function importPresetFile(): Promise<void> {
  const file = await window.fx.openFile(PRESET_FILTERS)
  if (file) loadPresetJson(new TextDecoder().decode(file.bytes), file.name)
}

export async function exportPresetFile(): Promise<void> {
  const app = useApp.getState()
  const name = app.presetName ?? `${baseName()} look`
  const bytes = new TextEncoder().encode(serializePreset(app, name))
  const path = await window.fx.saveFile(presetFileName(name), bytes, PRESET_SAVE_FILTERS)
  if (path) app.setMessage({ kind: 'info', text: `Saved ${path}` })
}

export { BUILTIN_PRESETS }

function inTextField(): boolean {
  const el = document.activeElement
  return (
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button', 'color'].includes(el.type))
  )
}

export function undo(): void {
  if (inTextField()) document.execCommand('undo')
  else useApp.getState().undo()
}

export function redo(): void {
  if (inTextField()) document.execCommand('redo')
  else useApp.getState().redo()
}

export function runMenuCommand(command: MenuCommand): void {
  const app = useApp.getState()
  switch (command) {
    case 'open-project': return void openProject()
    case 'save-project': return void saveProject()
    case 'save-project-as': return void saveProject({ as: true })
    case 'open': return void openImage()
    case 'open-model': return void openModel()
    case 'export': return app.image ? app.setExportOpen(true) : undefined
    case 'import-palette': return void importPalette()
    case 'presets': return app.setPresetsOpen(true)
    case 'import-preset': return void importPresetFile()
    case 'undo': return undo()
    case 'redo': return redo()
    case 'zoom-fit': return app.zoomFit()
    case 'zoom-actual': return app.zoomActual()
    case 'zoom-in': return app.zoomStep(1)
    case 'zoom-out': return app.zoomStep(-1)
    case 'toggle-grid': return app.toggleGrid()
    case 'toggle-split': return app.toggleSplit()
    case 'toggle-tile': return app.toggleTile()
    case 'toggle-live-reload': return app.setLiveReload(!app.liveReload)
    case 'theme-dark':
    case 'theme-night':
    case 'theme-light':
    case 'theme-matrix':
    case 'theme-retro':
      return app.setTheme(command.slice('theme-'.length) as Theme)
    case 'view-2d':
    case 'view-split':
    case 'view-3d':
      return app.setViewMode(command.slice('view-'.length) as ViewMode)
    case 'look-lit':
    case 'look-unlit':
    case 'look-wireframe':
    case 'look-unlit-wire':
    case 'look-clay':
    case 'look-normals':
    case 'look-psx':
    case 'look-n64':
    case 'look-custom':
      return app.setView3d({ look: command.slice('look-'.length) as View3dLookChoice })
    case 'gpu-diagnostics': return app.setDiagnosticsOpen(true)
    case 'settings': return app.setSettingsOpen(true)
  }
}
