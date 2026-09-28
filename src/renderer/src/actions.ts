import type { FileFilter, MenuCommand } from '@shared/api'
import { getEngine } from '@/engine'
import { decodeImage } from '@/image/decode'
import { countColors, hasTransparency, toIndexed } from '@/image/indexed'
import { encodeIndexedPng, encodePng, indexedBitDepth } from '@/image/png'
import { exportPalette, parsePaletteFile, type PaletteExportFormat } from '@/palette/formats'
import { MAX_PALETTE, rgb8ToHex } from '@/palette/palette'
import { BUILTIN_PRESETS, type BuiltinPreset } from '@/stack/builtinPresets'
import { parsePreset, PRESET_EXTENSION, presetFileName, serializePreset, type ParsedPreset } from '@/stack/preset'
import { useApp } from '@/store'

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export const PALETTE_EXTENSIONS = ['hex', 'gpl', 'pal', 'act', 'ase', 'txt']
const PALETTE_FILTERS: FileFilter[] = [{ name: 'Palettes', extensions: PALETTE_EXTENSIONS }]

export async function loadImageFile(name: string, bytes: Uint8Array): Promise<void> {
  const engine = getEngine()
  const { setMessage, setImage } = useApp.getState()
  if (!engine) return
  try {
    const bitmap = await decodeImage(name, bytes)
    engine.loadBitmap(bitmap)
    setImage({ name, width: bitmap.width, height: bitmap.height })
    bitmap.close()
    setMessage({ kind: 'info', text: `Loaded ${name}` })
  } catch (e) {
    setMessage({ kind: 'error', text: errorText(e) })
  }
}

export async function openImage(): Promise<void> {
  const file = await window.fx.openImage()
  if (file) await loadImageFile(file.name, file.bytes)
}

/** Dropped file: palette files become palettes, everything else is opened as an image. */
export async function openDroppedFile(name: string, bytes: Uint8Array): Promise<void> {
  const ext = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? ''
  if (ext === PRESET_EXTENSION) loadPresetJson(new TextDecoder().decode(bytes), name)
  else if (PALETTE_EXTENSIONS.includes(ext) && ext !== 'txt') importPaletteBytes(name, bytes)
  else await loadImageFile(name, bytes)
}

export type ExportFormat = 'png-rgba' | 'png-indexed'

export interface ExportOptions {
  format: ExportFormat
  /** Indexed only: palette whose order and colors become the PNG palette; null = the image's colors. */
  paletteId: string | null
}

const baseName = (): string => useApp.getState().image?.name.replace(/\.[^.]+$/, '') ?? 'texture'

/** What an export would produce, for the export dialog. */
export interface OutputSummary {
  width: number
  height: number
  /** Distinct colors (all fully transparent pixels count as one); stops counting at 257. */
  colors: number
  transparent: boolean
}

export async function describeOutput(): Promise<OutputSummary | null> {
  const engine = getEngine()
  if (!engine || !useApp.getState().image) return null
  const image = await engine.readOutput()
  return { width: image.width, height: image.height, colors: countColors(image), transparent: hasTransparency(image) }
}

/** Returns true when the file was written. */
export async function exportImage(options: ExportOptions): Promise<boolean> {
  const engine = getEngine()
  const { image, palettes, setMessage } = useApp.getState()
  if (!engine || !image) return false
  try {
    const rgba = await engine.readOutput()
    let bytes: Uint8Array
    let detail: string
    if (options.format === 'png-indexed') {
      const palette = options.paletteId ? palettes.find((p) => p.id === options.paletteId) : undefined
      const indexed = toIndexed(rgba, palette?.colors.map((c) => c.hex))
      bytes = await encodeIndexedPng(indexed)
      detail = `${indexed.palette.length} colors, ${indexedBitDepth(indexed.palette.length)}-bit indexed`
    } else {
      bytes = await encodePng(rgba)
      detail = 'RGBA'
    }
    const path = await window.fx.saveFile(`${baseName()}_4fx.png`, bytes, [{ name: 'PNG image', extensions: ['png'] }])
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

// ── Presets ────────────────────────────────────────────────────────────────

const PRESET_FILTERS: FileFilter[] = [{ name: '4FXELIZER preset', extensions: [PRESET_EXTENSION] }]

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
  const path = await window.fx.saveFile(presetFileName(name), bytes, PRESET_FILTERS)
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
    case 'open': return void openImage()
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
    case 'gpu-diagnostics': return app.setDiagnosticsOpen(true)
  }
}
