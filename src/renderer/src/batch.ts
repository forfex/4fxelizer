// File › Process Folder: runs the current stack on every texture of a folder and exports the
// results, without opening them. Each file gets a temporary engine slot that the store never sees,
// so the open textures, the undo history and the viewer stay as they are.

import type { BatchFolder } from '@shared/api'
import { batchOutputName } from '@shared/batch'
import { uniqueFileNames } from '@shared/exportNames'
import { encodeOutput, ENCODERS, parseExportFormat, type ExportOptions } from '@/actions'
import { getEngine, type Engine } from '@/engine'
import { decodeImage } from '@/image/decode'
import { generationKey, generatorInput } from '@/palette/controller'
import { generatePaletteAsync } from '@/palette/generateAsync'
import { mergeGenerated } from '@/palette/palette'
import type { Doc } from '@/stack/doc'
import { docFor } from '@/stack/textures'
import { newId, useApp } from '@/store'

/** Palettes that feed stages after the one they are generated from settle in a few rounds. */
const MAX_PALETTE_ROUNDS = 4

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export interface BatchProgress {
  done: number
  total: number
  /** The file being processed. */
  name: string
}

export interface BatchResult {
  written: number
  total: number
  failed: { name: string; reason: string }[]
  cancelled: boolean
  folder: string
}

/** The stack the folder is processed with: the active texture's, else the shared one. */
function batchDoc(): Doc {
  const { docs, activeTextureId } = useApp.getState()
  return structuredClone(activeTextureId ? docFor(docs, activeTextureId) : docs.shared)
}

/**
 * Runs the stack on a temporary slot until its generated palettes match the texture. Palettes
 * generated per texture get colors from this file; ones shared by every texture ("One for all")
 * and ones not set to update by themselves keep the colors they have now.
 */
async function runStack(engine: Engine, id: string, doc: Doc): Promise<void> {
  const generated = new Map<string, string>()
  for (let round = 0; round < MAX_PALETTE_ROUNDS; round++) {
    engine.processTexture(id, { ...doc, previewUid: null, mapChannels: {} })
    const { plan, sourceKey } = engine.planOf(id)
    let changed = false
    for (const palette of doc.palettes) {
      const settings = palette.generator
      if (!settings?.auto || settings.scope === 'all') continue
      // A stage's own palette only needs colors while that stage uses it.
      if (palette.ownerUid) {
        const owner = doc.stages.find((s) => s.uid === palette.ownerUid)
        const params = owner?.params as { mode?: string; paletteId?: string } | undefined
        if (!owner?.enabled || params?.mode !== 'palette' || params.paletteId !== palette.id) continue
      }
      const input = generatorInput(palette, plan, sourceKey)
      if ('blocked' in input) continue
      const key = generationKey(palette, input.key)
      if (generated.get(palette.id) === key) continue
      const sample = await engine.samplePixels(input.key, 512, id)
      const locked = palette.colors.filter((c) => c.locked).map((c) => c.hex)
      const colors = await generatePaletteAsync(sample.data, { ...settings, locked })
      palette.colors = mergeGenerated(palette.colors, colors, settings.count)
      generated.set(palette.id, key)
      changed = true
    }
    if (!changed) return
  }
}

/**
 * Processes the folder's textures into `outFolder` (picked with chooseExportFolder), named like
 * each texture (rock_4fx.png). A file that fails is reported and the rest carry on.
 */
export async function processFolder(
  input: BatchFolder,
  outFolder: string,
  options: ExportOptions,
  onProgress: (progress: BatchProgress) => void,
  cancelled: () => boolean
): Promise<BatchResult> {
  const engine = getEngine()
  const total = input.files.length
  const result: BatchResult = { written: 0, total, failed: [], cancelled: false, folder: outFolder }
  if (!engine) return result
  const extension = ENCODERS[parseExportFormat(options.format).type].filter.extensions[0]!
  const names = uniqueFileNames(input.files.map((f) => batchOutputName(f.name, extension)))
  const template = batchDoc()
  for (const [i, file] of input.files.entries()) {
    if (cancelled()) {
      result.cancelled = true
      break
    }
    onProgress({ done: i, total, name: file.name })
    const id = newId('batch')
    try {
      const opened = await window.fx.readBatchFile(file.path)
      if (!opened) throw new Error("the file can't be read")
      const bitmap = await decodeImage(opened.name, opened.bytes)
      engine.loadBitmap(bitmap, id)
      bitmap.close()
      const doc = structuredClone(template)
      await runStack(engine, id, doc)
      const rgba = await engine.readOutput(id)
      const { bytes } = await encodeOutput(rgba, options, doc.palettes)
      await window.fx.writeExportFile(outFolder, names[i]!, bytes)
      result.written++
    } catch (e) {
      result.failed.push({ name: file.name, reason: errorText(e) })
    } finally {
      engine.disposeTexture(id)
    }
  }
  onProgress({ done: result.written + result.failed.length, total, name: '' })
  return result
}
