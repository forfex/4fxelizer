import type { PassDef } from '../pass'
import { adjust, DEFAULT_ADJUST } from './adjust'
import { dither, DEFAULT_DITHER } from './dither'
import { downscale, DEFAULT_DOWNSCALE } from './downscale'
import { quantize, DEFAULT_QUANTIZE } from './quantize'
import { upscale, DEFAULT_UPSCALE } from './upscale'

export const PASSES: ReadonlyMap<string, PassDef<never>> = new Map(
  [adjust, downscale, upscale, quantize, dither].map((p) => [p.id, p as PassDef<never>])
)

/** Stage types the user can add to the stack, in "+ Add" menu order. */
export const STAGE_TYPES = [
  { passId: 'adjust', label: 'Adjust', hint: 'Levels, gamma, contrast, saturation, hue, sharpen.', defaults: DEFAULT_ADJUST },
  { passId: 'downscale', label: 'Downscale', hint: 'Reduce resolution with a choice of filters.', defaults: DEFAULT_DOWNSCALE },
  { passId: 'upscale', label: 'Upscale', hint: 'Enlarge with a texture filter: N64 3-point, bilinear, bicubic or nearest.', defaults: DEFAULT_UPSCALE },
  { passId: 'quantize', label: 'Quantize', hint: 'Snap colors to a palette or to N levels per channel.', defaults: DEFAULT_QUANTIZE },
  { passId: 'dither', label: 'Dither', hint: 'Ordered (Bayer) or blue-noise dithering.', defaults: DEFAULT_DITHER }
] as const

export type StagePassId = (typeof STAGE_TYPES)[number]['passId']

export function stageLabel(passId: string): string {
  return STAGE_TYPES.find((t) => t.passId === passId)?.label ?? passId
}
