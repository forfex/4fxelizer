// Keeps generated palettes up to date: after every stack run (of any open texture), palettes
// with "auto" regenerate when the image they're generated from (source or a stage's input) or
// their settings change. On the shared stack a palette is generated per texture (each texture gets
// colors from its own pixels) or from all textures on it together.

import { getEngine, type Engine } from '@/engine'
import type { ChainPlan } from '@/gpu/plan'
import { hashString, stableStringify } from '@/gpu/plan'
import { useApp } from '@/store'
import { snapsColors } from '@/stack/analyze'
import type { Doc } from '@/stack/doc'
import { docAt, docFor, docKeyOf, perTexture, SHARED, sharedTextures } from '@/stack/textures'
import { generatePaletteAsync } from './generateAsync'
import { mergeGenerated, type Palette } from './palette'

const DEBOUNCE_MS = 150

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** What a palette is generated for: one texture, or every texture on the shared stack. */
type Target = { textureId: string } | 'all'

/** Cache key of the image a palette is generated from, or a reason it can't be generated. */
function generatorInput(
  palette: Palette,
  plan: ChainPlan | null,
  sourceKey: string | null
): { key: string } | { blocked: string } {
  const from = palette.generator!.from
  if (!sourceKey) return { blocked: 'Load an image first.' }
  if (from.kind === 'source') return { key: sourceKey }
  const stages = plan?.stages ?? []
  const index = stages.findIndex((s) => s.stage.uid === from.uid)
  if (index < 0) return { blocked: 'The stage it is generated from is no longer in the stack.' }
  // A palette generated from a stage's input can't feed a stage before that point (it would
  // depend on itself).
  const feedsBack = stages.slice(0, index).some((s) => {
    const params = s.stage.params as { paletteId?: string; mode?: string }
    return s.stage.enabled && params.paletteId === palette.id && snapsColors(s.stage)
  })
  if (feedsBack) return { blocked: 'It is used by a stage before the one it is generated from. Pick an earlier source.' }
  return { key: stages[index]!.inputKey }
}

function generationKey(palette: Palette, inputKey: string): string {
  const locked = palette.colors.filter((c) => c.locked).map((c) => c.hex)
  const { auto: _auto, ...settings } = palette.generator!
  return hashString(`${inputKey}|${stableStringify(settings)}|${locked.join(',')}`)
}

/** Whether a palette is generated from every texture on the shared stack. */
function fromAll(palette: Palette, docKey: string): boolean {
  return docKey === SHARED && palette.generator?.scope === 'all'
}

/** The inputs a palette is generated from for a target, and their generation key. */
function inputsFor(engine: Engine, palette: Palette, target: Target): { inputs: { textureId: string; key: string }[]; key: string } | { blocked: string } {
  const { textures, docs } = useApp.getState()
  const ids = target === 'all' ? sharedTextures(textures, docs).map((t) => t.id) : [target.textureId]
  if (!ids.length) return { blocked: 'Load an image first.' }
  const inputs: { textureId: string; key: string }[] = []
  for (const textureId of ids) {
    const { plan, sourceKey } = engine.planOf(textureId)
    // Another texture not processed yet: generate once it is (no message).
    if (target === 'all' && !plan) return { blocked: '' }
    const input = generatorInput(palette, plan, sourceKey)
    if ('blocked' in input) return input
    inputs.push({ textureId, key: input.key })
  }
  return { inputs, key: generationKey(palette, inputs.map((i) => i.key).join('+')) }
}

/** The palette as generated for a target (its own colors on the shared stack when generated per texture). */
function paletteFor(paletteId: string, target: Target): Palette | undefined {
  const { docs } = useApp.getState()
  const doc: Doc = target === 'all' ? docs.shared : docFor(docs, target.textureId)
  return doc.palettes.find((p) => p.id === paletteId)
}

/** Job statuses are shown for the active texture, and for palettes generated from every texture. */
function showsJob(target: Target): boolean {
  return target === 'all' || target.textureId === useApp.getState().activeTextureId
}

async function generate(paletteId: string, target: Target): Promise<void> {
  const engine = getEngine()
  const app = useApp.getState()
  const palette = paletteFor(paletteId, target)
  if (!engine || !palette?.generator) return
  const found = inputsFor(engine, palette, target)
  if ('blocked' in found) {
    if (found.blocked && showsJob(target)) app.setPaletteJob(paletteId, { status: 'blocked', message: found.blocked })
    return
  }
  const settings = palette.generator
  if (showsJob(target)) app.setPaletteJob(paletteId, { status: 'running' })
  try {
    const samples = await Promise.all(found.inputs.map((i) => engine.samplePixels(i.key, 512, i.textureId)))
    const pixels = new Uint8Array(samples.reduce((n, s) => n + s.data.length, 0))
    let offset = 0
    for (const s of samples) {
      pixels.set(s.data, offset)
      offset += s.data.length
    }
    const locked = palette.colors.filter((c) => c.locked).map((c) => c.hex)
    const colors = await generatePaletteAsync(pixels, { ...settings, locked })
    const current = paletteFor(paletteId, target)
    if (!current) return
    const merged = mergeGenerated(current.colors, colors, settings.count)
    useApp.getState().setGeneratedColors(target === 'all' ? null : target.textureId, paletteId, merged, found.key)
    if (showsJob(target)) useApp.getState().setPaletteJob(paletteId, null)
  } catch (e) {
    if (showsJob(target)) useApp.getState().setPaletteJob(paletteId, { status: 'error', message: errorText(e) })
  }
}

/** Generates colors for a palette of the active texture now (the Generate button). */
export async function generatePaletteNow(paletteId: string): Promise<void> {
  const { activeTextureId, docs } = useApp.getState()
  if (!activeTextureId) return
  const key = docKeyOf(docs, activeTextureId)
  const palette = docAt(docs, key).palettes.find((p) => p.id === paletteId)
  await generate(paletteId, palette && fromAll(palette, key) ? 'all' : { textureId: activeTextureId })
}

export function startPaletteController(engine: Engine): () => void {
  /** Key of the generation scheduled or running per palette and target (cleared once it finishes). */
  const pendingKey = new Map<string, string>()
  const timers = new Map<string, number>()
  const running = new Map<string, Promise<void>>()

  const schedule = (job: string, paletteId: string, target: Target, key: string): void => {
    window.clearTimeout(timers.get(job))
    timers.set(
      job,
      window.setTimeout(async () => {
        timers.delete(job)
        await running.get(job)
        if (pendingKey.get(job) !== key) return // superseded while waiting
        const run = generate(paletteId, target)
        running.set(job, run)
        await run
        running.delete(job)
        if (pendingKey.get(job) === key) pendingKey.delete(job)
      }, DEBOUNCE_MS)
    )
  }

  return engine.onPlan((_plan, _sourceKey, textureId) => {
    const { docs, textures, paletteJobs, setPaletteJob } = useApp.getState()
    if (!textures.some((t) => t.id === textureId)) return
    const docKey = docKeyOf(docs, textureId)
    const doc = docFor(docs, textureId)
    const active = textureId === useApp.getState().activeTextureId
    for (const palette of doc.palettes) {
      if (!palette.generator?.auto) continue
      // A stage's own palette only needs colors while that stage actually uses it.
      if (palette.ownerUid) {
        const owner = doc.stages.find((s) => s.uid === palette.ownerUid)
        const params = owner?.params as { mode?: string; paletteId?: string } | undefined
        if (!owner?.enabled || params?.mode !== 'palette' || params.paletteId !== palette.id) continue
      }
      const target: Target = fromAll(palette, docKey) ? 'all' : { textureId }
      const shown = active || target === 'all'
      const found = inputsFor(engine, palette, target)
      if ('blocked' in found) {
        const job = paletteJobs[palette.id]
        if (found.blocked && shown && (job?.status !== 'blocked' || job.message !== found.blocked)) {
          setPaletteJob(palette.id, { status: 'blocked', message: found.blocked })
        }
        continue
      }
      if (shown && paletteJobs[palette.id]?.status === 'blocked') setPaletteJob(palette.id, null)
      const jobKey = `${palette.id}|${target === 'all' ? 'all' : textureId}`
      // Colors already match (also after an undo that restored them), or a run is on its way.
      const current = target !== 'all' && perTexture(palette, docKey) ? palette.variants?.[textureId]?.generatedFor : palette.generatedFor
      if (current === found.key || pendingKey.get(jobKey) === found.key) continue
      pendingKey.set(jobKey, found.key)
      schedule(jobKey, palette.id, target, found.key)
    }
  })
}
