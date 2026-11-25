// Pure one-line summaries of a stage's settings, shown on collapsed stage cards ("128 px · Box",
// "Bayer 4×4 · 16 colors", "No changes").

import { DEFAULT_ADJUST, type AdjustParams } from '@/gpu/passes/adjust'
import { DITHER_PATTERNS, type DitherParams } from '@/gpu/passes/dither'
import { DOWNSCALE_METHODS, type DownscaleParams } from '@/gpu/passes/downscale'
import type { QuantizeParams } from '@/gpu/passes/quantize'
import { UPSCALE_METHODS, type UpscaleParams } from '@/gpu/passes/upscale'
import type { StageSpec } from '@/gpu/plan'
import type { Palette } from '@/palette/palette'

const SEP = ' · '

const label = (list: readonly { id: string; label: string }[], id: string): string => list.find((m) => m.id === id)?.label ?? id

/** "+0.25", "−0.1", "1.5": a signed value for settings centered on 0. */
const signed = (v: number, digits = 2): string => {
  const text = String(Number(Math.abs(v).toFixed(digits)))
  return v > 0 ? `+${text}` : v < 0 ? `−${text}` : text
}

/** Changed Adjust rows, in the editor's order. */
function adjustChanges(p: AdjustParams): string[] {
  const d = DEFAULT_ADJUST
  const out: string[] = []
  if (p.brightness !== d.brightness) out.push(`Brightness ${signed(p.brightness)}`)
  if (p.contrast !== d.contrast) out.push(`Contrast ${signed(p.contrast)}`)
  if (p.gamma !== d.gamma) out.push(`Gamma ${Number(p.gamma.toFixed(2))}`)
  if (p.saturation !== d.saturation) out.push(`Saturation ${signed(p.saturation)}`)
  if (p.hue !== d.hue) out.push(`Hue ${signed(p.hue, 0)}°`)
  if (p.sharpen !== d.sharpen) out.push(`Sharpen ${Number(p.sharpen.toFixed(2))}`)
  if (p.inBlack !== d.inBlack || p.inWhite !== d.inWhite || p.outBlack !== d.outBlack || p.outWhite !== d.outWhite) out.push('Levels')
  if ((p.ao ?? 0) > 0) out.push('AO')
  if ((p.cavity ?? 0) > 0) out.push('Cavity')
  return out
}

/** Whether any of Adjust's rarely used rows (levels, AO and cavity shading) is changed. */
export function adjustMoreChanged(p: AdjustParams): boolean {
  const d = DEFAULT_ADJUST
  return p.inBlack !== d.inBlack || p.inWhite !== d.inWhite || p.outBlack !== d.outBlack || p.outWhite !== d.outWhite || (p.ao ?? 0) > 0 || (p.cavity ?? 0) > 0
}

/** Where a palette stage's colors come from: "16 colors" (generated), the palette's name, or "No palette". */
function paletteText(stage: StageSpec, paletteId: string | null, palettes: readonly Palette[]): string {
  const palette = palettes.find((p) => p.id === paletteId)
  if (!palette) return 'No palette'
  if (palette.generator && palette.ownerUid === stage.uid) return `${palette.generator.count} colors`
  return palette.name
}

const levelsText = (levels: number): string => `${levels} levels`

/** A short readable summary of a stage's settings. */
export function stageSummary(stage: StageSpec, palettes: readonly Palette[]): string {
  switch (stage.passId) {
    case 'adjust': {
      const changes = adjustChanges(stage.params as AdjustParams)
      if (!changes.length) return 'No changes'
      return changes.length > 3 ? [...changes.slice(0, 2), `${changes.length - 2} more`].join(SEP) : changes.join(SEP)
    }
    case 'downscale': {
      const p = stage.params as DownscaleParams
      const size = p.sizeMode === 'longest' ? `${p.longest} px` : p.sizeMode === 'exact' ? `${p.width}×${p.height}` : `${Math.round(p.scale * 100)}%`
      return [size, label(DOWNSCALE_METHODS, p.method), p.pot && 'POT'].filter(Boolean).join(SEP)
    }
    case 'upscale': {
      const p = stage.params as UpscaleParams
      return [p.sizeMode === 'source' ? 'Original size' : `${p.factor}×`, label(UPSCALE_METHODS, p.method)].join(SEP)
    }
    case 'quantize': {
      const p = stage.params as QuantizeParams
      return p.mode === 'levels' ? levelsText(p.levels) : paletteText(stage, p.paletteId, palettes)
    }
    case 'dither': {
      const p = stage.params as DitherParams
      const target = p.mode === 'palette' ? paletteText(stage, p.paletteId, palettes) : p.mode === 'levels' ? levelsText(p.levels) : 'Pattern only'
      return [label(DITHER_PATTERNS, p.pattern), target].join(SEP)
    }
    default:
      return ''
  }
}
