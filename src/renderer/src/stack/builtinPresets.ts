// Built-in presets (plan: "PSX 8bpp", "PSX 4bpp", "NES-ish", "Crunchy", …), built with the same
// document operations the UI uses.

import { BUILTIN_PALETTES } from '@/palette/builtins'
import { makeStage, newId, ownedPalette, toProjectPalette, type Doc } from './doc'

export interface BuiltinPreset {
  name: string
  hint: string
  build(): Doc
}

type StageRecipe = [passId: string, params?: Record<string, unknown>]

interface Recipe {
  stages: StageRecipe[]
  /** Generated color count for the last palette stage. */
  colors?: number
  /** Use this built-in palette instead of a generated one. */
  palette?: string
  lock?: boolean
}

function build({ stages: recipe, colors, palette, lock }: Recipe): Doc {
  let doc: Doc = { stages: [], palettes: [], outputLock: { enabled: false, paletteId: null } }
  for (const [passId, params] of recipe) {
    const { stage, palettes } = makeStage(passId)
    stage.params = { ...(stage.params as object), ...params }
    doc = { ...doc, stages: [...doc.stages, stage], palettes: [...doc.palettes, ...palettes] }
  }
  const last = [...doc.stages].reverse().find((s) => s.passId === 'dither' || s.passId === 'quantize')
  if (!last) return doc

  if (palette) {
    const builtin = BUILTIN_PALETTES.find((b) => b.name === palette)!
    const project = { id: newId('pal'), name: builtin.name, colors: builtin.colors.map((hex) => ({ hex })) }
    doc = { ...doc, palettes: [...doc.palettes, project] }
    doc = { ...doc, ...toProjectPalette(doc, last.uid, project.id) }
  } else if (colors) {
    doc = {
      ...doc,
      palettes: doc.palettes.map((p) => (p.ownerUid === last.uid ? { ...p, generator: { ...p.generator!, count: colors } } : p))
    }
  }
  const lastPalette = (doc.stages.find((s) => s.uid === last.uid)!.params as { paletteId: string | null }).paletteId
  doc.outputLock = { enabled: !!lock, paletteId: lastPalette ?? ownedPalette(doc, last.uid)?.id ?? null }
  return doc
}

export const BUILTIN_PRESETS: BuiltinPreset[] = [
  {
    name: 'PSX 8bpp',
    hint: '256×256 max, 255 colors + transparency (fits an 8-bit CLUT), light Bayer dither.',
    build: () =>
      build({
        stages: [
          ['downscale', { longest: 256, pot: true, method: 'box' }],
          ['dither', { pattern: 'bayer4', strength: 0.35 }]
        ],
        colors: 255,
        lock: true
      })
  },
  {
    name: 'PSX 4bpp',
    hint: '128×128, 15 colors + transparency (fits a 4-bit CLUT), Bayer dither.',
    build: () =>
      build({
        stages: [
          ['downscale', { longest: 128, pot: true, method: 'box' }],
          ['dither', { pattern: 'bayer4', strength: 0.5 }]
        ],
        colors: 15,
        lock: true
      })
  },
  {
    name: 'PSX 15-bit direct',
    hint: '256×256, 5 bits per channel with ordered dithering (no palette).',
    build: () =>
      build({
        stages: [
          ['downscale', { longest: 256, pot: true, method: 'box' }],
          ['dither', { mode: 'levels', levels: 32, pattern: 'bayer4', strength: 1 }]
        ]
      })
  },
  {
    name: 'N64',
    hint:
      '64 px texture in 16-bit color (RGBA 5551), blurred ×4 by the N64 3-point filter, then the 16-bit ' +
      'framebuffer dither (magic square). For the in-game texture, preview/export at the Quantize stage.',
    build: () =>
      build({
        stages: [
          ['downscale', { longest: 64, pot: true, method: 'box' }],
          ['quantize', { mode: 'levels', levels: 32, alpha: 'binary' }],
          ['upscale', { method: 'n64', sizeMode: 'factor', factor: 4, wrap: true }],
          ['dither', { mode: 'levels', levels: 32, pattern: 'n64-magic', strength: 1 }]
        ]
      })
  },
  {
    name: 'NES-ish',
    hint: '64 px, NES palette, two-color Bayer mixing.',
    build: () =>
      build({
        stages: [
          ['adjust', { contrast: 0.15, saturation: 0.15 }],
          ['downscale', { longest: 64, method: 'box' }],
          ['dither', { pattern: 'bayer2', twoNearest: true, strength: 1 }]
        ],
        palette: 'NES'
      })
  },
  {
    name: 'Game Boy',
    hint: 'Grayscale, 128 px, 4-shade Game Boy palette with Bayer dithering.',
    build: () =>
      build({
        stages: [
          ['adjust', { saturation: -1, contrast: 0.2 }],
          ['downscale', { longest: 128, method: 'box' }],
          ['dither', { pattern: 'bayer4', twoNearest: true, strength: 1 }]
        ],
        palette: 'Game Boy (DMG)'
      })
  },
  {
    name: 'Crunchy',
    hint: 'Sharpened, 64 px contrast-aware downscale, 8 colors, heavy 2×2 dither.',
    build: () =>
      build({
        stages: [
          ['adjust', { sharpen: 1, contrast: 0.25, saturation: 0.2 }],
          ['downscale', { longest: 64, method: 'contrast', detail: 0.6 }],
          ['dither', { pattern: 'bayer2', twoNearest: true, strength: 1 }]
        ],
        colors: 8
      })
  }
]
