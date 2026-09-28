// Pure analysis of the stage stack for the UI: per-stage sizes and order warnings.

import type { Size } from '@/gpu/pass'
import type { StageSpec } from '@/gpu/plan'
import { ditherPeriod, type DitherParams } from '@/gpu/passes/dither'
import { downscaleSize, type DownscaleParams } from '@/gpu/passes/downscale'
import type { QuantizeParams } from '@/gpu/passes/quantize'
import { stageLabel } from '@/gpu/passes'
import type { Palette } from '@/palette/palette'

export interface OutputLock {
  enabled: boolean
  paletteId: string | null
}

export interface StageInfo {
  /** Size of the stage's input and output (equal when the stage doesn't resize). */
  input: Size
  output: Size
  warnings: string[]
}

function isFullStrength(s: StageSpec): boolean {
  return s.blend.opacity >= 1 && s.blend.mode === 'normal'
}

/** Stage output only contains colors from a fixed set (palette or levels). */
export function snapsColors(s: StageSpec): boolean {
  if (!s.enabled || !isFullStrength(s)) return false
  if (s.passId === 'quantize') return true
  if (s.passId === 'dither') return (s.params as DitherParams).mode !== 'pattern'
  return false
}

/** Stage can output colors that weren't in its input. */
export function makesNewColors(s: StageSpec): boolean {
  if (!s.enabled) return false
  if (!isFullStrength(s)) return true
  if (s.passId === 'adjust') return true
  if (s.passId === 'downscale') return !['nearest', 'median'].includes((s.params as DownscaleParams).method)
  if (s.passId === 'dither') return (s.params as DitherParams).mode === 'pattern'
  return false
}

function paletteRef(s: StageSpec): string | null | undefined {
  if (s.passId === 'quantize') {
    const p = s.params as QuantizeParams
    return p.mode === 'palette' ? p.paletteId : undefined
  }
  if (s.passId === 'dither') {
    const p = s.params as DitherParams
    return p.mode === 'palette' ? p.paletteId : undefined
  }
  return undefined
}

export function analyzeStack(
  source: Size | null,
  stages: StageSpec[],
  palettes: Palette[],
  lock: OutputLock
): Map<string, StageInfo> {
  const info = new Map<string, StageInfo>()
  let size = source ?? { width: 0, height: 0 }
  const paletteById = new Map(palettes.map((p) => [p.id, p]))

  stages.forEach((s, i) => {
    const warnings: string[] = []
    const input = size
    let output = size
    if (s.enabled && s.passId === 'downscale' && source) output = downscaleSize(input, s.params as DownscaleParams)

    if (s.enabled) {
      const ref = paletteRef(s)
      if (ref !== undefined) {
        const pal = ref ? paletteById.get(ref) : undefined
        if (!pal) warnings.push('Pick a palette.')
        else if (!pal.colors.length) warnings.push(`Palette "${pal.name}" has no colors yet.`)
      }

      const later = stages.slice(i + 1)
      const snappedLater = later.some(snapsColors) || (lock.enabled && !!lock.paletteId)
      const earlierSnap = stages.slice(0, i).reverse().find(snapsColors)
      if (earlierSnap && makesNewColors(s) && !snappedLater) {
        warnings.push(
          `${stageLabel(s.passId)} after ${stageLabel(earlierSnap.passId)} produces colors outside the palette. ` +
            'Move it earlier, add a Quantize after it, or turn on the output palette lock.'
        )
      }

      if (s.passId === 'dither') {
        const p = s.params as DitherParams
        if (p.mode === 'pattern' && !later.some(snapsColors) && !(lock.enabled && lock.paletteId)) {
          warnings.push('"Pattern only" adds the pattern without reducing colors. Add a Quantize after it.')
        }
        const period = ditherPeriod(p)
        if (source && (input.width % period !== 0 || input.height % period !== 0)) {
          warnings.push(`The ${period}px pattern doesn't divide ${input.width}×${input.height}, so the texture won't tile seamlessly.`)
        }
      }
    }

    info.set(s.uid, { input, output, warnings })
    size = output
  })
  return info
}
