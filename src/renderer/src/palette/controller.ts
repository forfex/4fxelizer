// Keeps generated palettes up to date: after every stack run, palettes with "auto" regenerate
// when the image they're generated from (source or a stage's input) or their settings change.

import { getEngine, type Engine } from '@/engine'
import type { ChainPlan } from '@/gpu/plan'
import { hashString, stableStringify } from '@/gpu/plan'
import { useApp } from '@/store'
import { snapsColors } from '@/stack/analyze'
import { generatePaletteAsync } from './generateAsync'
import { mergeGenerated, type Palette } from './palette'

const DEBOUNCE_MS = 150

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

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

/** Generates colors for a palette now. Auto runs don't create an undo step. */
export async function generatePaletteNow(paletteId: string, opts: { silent?: boolean } = {}): Promise<void> {
  const engine = getEngine()
  const app = useApp.getState()
  const palette = app.palettes.find((p) => p.id === paletteId)
  if (!engine || !palette?.generator) return
  const input = generatorInput(palette, engine.lastProcessedPlan, engine.sourceKey)
  if ('blocked' in input) {
    app.setPaletteJob(paletteId, { status: 'blocked', message: input.blocked })
    return
  }
  const settings = palette.generator
  const generatedFor = generationKey(palette, input.key)
  app.setPaletteJob(paletteId, { status: 'running' })
  try {
    const pixels = await engine.samplePixels(input.key)
    const locked = palette.colors.filter((c) => c.locked).map((c) => c.hex)
    const colors = await generatePaletteAsync(pixels.data, { ...settings, locked })
    const current = useApp.getState().palettes.find((p) => p.id === paletteId)
    if (!current) return
    useApp
      .getState()
      .updatePalette(paletteId, { colors: mergeGenerated(current.colors, colors, settings.count), generatedFor }, opts)
    useApp.getState().setPaletteJob(paletteId, null)
  } catch (e) {
    useApp.getState().setPaletteJob(paletteId, { status: 'error', message: errorText(e) })
  }
}

export function startPaletteController(engine: Engine): () => void {
  /** Key of the generation scheduled or running per palette (cleared once it finishes). */
  const pendingKey = new Map<string, string>()
  const timers = new Map<string, number>()
  const running = new Map<string, Promise<void>>()

  const schedule = (id: string, key: string): void => {
    window.clearTimeout(timers.get(id))
    timers.set(
      id,
      window.setTimeout(async () => {
        timers.delete(id)
        await running.get(id)
        if (pendingKey.get(id) !== key) return // superseded while waiting
        const job = generatePaletteNow(id, { silent: true })
        running.set(id, job)
        await job
        running.delete(id)
        if (pendingKey.get(id) === key) pendingKey.delete(id)
      }, DEBOUNCE_MS)
    )
  }

  return engine.onPlan((plan, sourceKey) => {
    const { palettes, paletteJobs, setPaletteJob } = useApp.getState()
    const { stages } = useApp.getState()
    for (const palette of palettes) {
      if (!palette.generator?.auto) continue
      // A stage's own palette only needs colors while that stage actually uses it.
      if (palette.ownerUid) {
        const owner = stages.find((s) => s.uid === palette.ownerUid)
        const params = owner?.params as { mode?: string; paletteId?: string } | undefined
        if (!owner?.enabled || params?.mode !== 'palette' || params.paletteId !== palette.id) continue
      }
      const input = generatorInput(palette, plan, sourceKey)
      if ('blocked' in input) {
        const job = paletteJobs[palette.id]
        if (job?.status !== 'blocked' || job.message !== input.blocked) {
          setPaletteJob(palette.id, { status: 'blocked', message: input.blocked })
        }
        pendingKey.delete(palette.id)
        continue
      }
      if (paletteJobs[palette.id]?.status === 'blocked') setPaletteJob(palette.id, null)
      const key = generationKey(palette, input.key)
      // Colors already match (also after an undo that restored them), or a run is on its way.
      if (palette.generatedFor === key || pendingKey.get(palette.id) === key) continue
      pendingKey.set(palette.id, key)
      schedule(palette.id, key)
    }
  })
}
