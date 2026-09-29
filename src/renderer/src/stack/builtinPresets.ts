// Built-in presets, grouped by category (hardware looks, then stylized ones that show off masks,
// blending, error diffusion and the other stage features). Built with the same document operations
// the UI uses.

import type { MaskSpec } from '@/gpu/mask'
import type { StageBlend } from '@/gpu/pass'
import { BUILTIN_PALETTES } from '@/palette/builtins'
import type { GeneratorSettings } from '@/palette/palette'
import { makeStage, newId, ownedPalette, readsPalette, toProjectPalette, type Doc } from './doc'

export const PRESET_CATEGORIES = [
  { id: 'console', label: 'Consoles' },
  { id: 'computer', label: 'Computers' },
  { id: 'stylized', label: 'Stylized' }
] as const

export type PresetCategory = (typeof PRESET_CATEGORIES)[number]['id']

export interface BuiltinPreset {
  name: string
  category: PresetCategory
  hint: string
  build(): Doc
}

interface StageOptions {
  blend?: Partial<Omit<StageBlend, 'mask'>> & { mask?: Partial<MaskSpec> & Pick<MaskSpec, 'a'> }
  /** Palette stages: generated color count. */
  colors?: number
  /** Palette stages: other settings of the generated palette. */
  generator?: Partial<Pick<GeneratorSettings, 'method' | 'gamma' | 'color15' | 'lumaWeight' | 'chromaWeight'>>
  /** Palette stages: a built-in palette (by name) or these colors instead of a generated one. */
  palette?: string | { name: string; colors: string[] }
}

type StageRecipe = [passId: string, params?: Record<string, unknown>, options?: StageOptions]

interface Recipe {
  stages: StageRecipe[]
  /** Output palette lock on the last palette stage's palette. */
  lock?: boolean
}

function build({ stages: recipe, lock }: Recipe): Doc {
  let doc: Doc = { stages: [], palettes: [], outputLock: { enabled: false, paletteId: null } }
  for (const [passId, params, options = {}] of recipe) {
    const { stage, palettes } = makeStage(passId)
    stage.params = { ...(stage.params as object), ...params }
    if (options.blend) {
      const { mask, ...rest } = options.blend
      stage.blend = { ...stage.blend, ...rest }
      if (mask) stage.blend.mask = { aInvert: false, b: 'none', bInvert: false, combine: 'multiply', blur: 0, wrap: false, ...mask }
    }
    doc = { ...doc, stages: [...doc.stages, stage], palettes: [...doc.palettes, ...palettes] }

    if (options.palette) {
      const source = typeof options.palette === 'string' ? BUILTIN_PALETTES.find((b) => b.name === options.palette)! : options.palette
      const project = { id: newId('pal'), name: source.name, colors: source.colors.map((hex) => ({ hex })) }
      doc = { ...doc, palettes: [...doc.palettes, project] }
      doc = { ...doc, ...toProjectPalette(doc, stage.uid, project.id) }
    } else if (options.colors || options.generator) {
      doc = {
        ...doc,
        palettes: doc.palettes.map((p) =>
          p.ownerUid === stage.uid ? { ...p, generator: { ...p.generator!, ...(options.colors ? { count: options.colors } : {}), ...options.generator } } : p
        )
      }
    }
  }
  const last = [...doc.stages].reverse().find(readsPalette)
  if (!last) return doc
  const paletteId = (last.params as { paletteId: string | null }).paletteId
  doc.outputLock = { enabled: !!lock, paletteId: paletteId ?? ownedPalette(doc, last.uid)?.id ?? null }
  return doc
}

const PSX15 = { color15: true }

export const BUILTIN_PRESETS: BuiltinPreset[] = [
  // ── Consoles ──────────────────────────────────────────────────────────────
  {
    name: 'PSX 8bpp',
    category: 'console',
    hint: '256×256 max, 255 colors + transparency (fits an 8-bit CLUT), light Bayer dither.',
    build: () =>
      build({
        stages: [
          ['downscale', { longest: 256, pot: true, method: 'box' }],
          ['dither', { pattern: 'bayer4', strength: 0.35 }, { colors: 255, generator: PSX15 }]
        ],
        lock: true
      })
  },
  {
    name: 'PSX 4bpp',
    category: 'console',
    hint: '128×128, 15 colors + transparency (fits a 4-bit CLUT), Bayer dither.',
    build: () =>
      build({
        stages: [
          ['downscale', { longest: 128, pot: true, method: 'box' }],
          ['dither', { pattern: 'bayer4', strength: 0.5 }, { colors: 15, generator: PSX15 }]
        ],
        lock: true
      })
  },
  {
    name: 'PSX 15-bit direct',
    category: 'console',
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
    category: 'console',
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
    name: 'Saturn mesh',
    category: 'console',
    hint:
      'Sega Saturn: 128 px in 15-bit color, and its "mesh" transparency: soft alpha becomes a checkerboard ' +
      'of opaque and clear texels.',
    build: () =>
      build({
        stages: [
          ['downscale', { longest: 128, pot: true, method: 'box' }],
          ['dither', { mode: 'levels', levels: 32, pattern: 'checker', strength: 1, alpha: 'dither' }]
        ]
      })
  },
  {
    name: 'SNES',
    category: 'console',
    hint:
      'Super Nintendo: 128 px, 15 colors + transparency (a 4bpp tile palette) in 15-bit color, no dither. ' +
      'The median downscale keeps real colors from the texture.',
    build: () =>
      build({
        stages: [
          ['adjust', { saturation: 0.1, contrast: 0.05 }],
          ['downscale', { longest: 128, method: 'median' }],
          ['quantize', { alpha: 'binary' }, { colors: 15, generator: { method: 'wu', color15: true } }]
        ],
        lock: true
      })
  },
  {
    name: 'Mega Drive',
    category: 'console',
    hint:
      'Sega Mega Drive / Genesis: 128 px, 15 colors from its 9-bit color (8 levels per channel), with the ' +
      'vertical-stripe dither that composite video blurred into extra shades.',
    build: () =>
      build({
        stages: [
          ['downscale', { longest: 128, method: 'box' }],
          ['dither', { pattern: 'lines-v', mixing: 'two-nearest', strength: 0.8 }, { colors: 15 }],
          ['quantize', { mode: 'levels', levels: 8 }]
        ]
      })
  },
  {
    name: 'NES-ish',
    category: 'console',
    hint: '64 px, NES palette, two-color Bayer mixing.',
    build: () =>
      build({
        stages: [
          ['adjust', { contrast: 0.15, saturation: 0.15 }],
          ['downscale', { longest: 64, method: 'box' }],
          ['dither', { pattern: 'bayer2', twoNearest: true, strength: 1 }, { palette: 'NES' }]
        ]
      })
  },
  {
    name: 'Game Boy',
    category: 'console',
    hint: 'Grayscale, 128 px, 4-shade Game Boy palette with Bayer dithering.',
    build: () =>
      build({
        stages: [
          ['adjust', { saturation: -1, contrast: 0.2 }],
          ['downscale', { longest: 128, method: 'box' }],
          ['dither', { pattern: 'bayer4', twoNearest: true, strength: 1 }, { palette: 'Game Boy (DMG)' }]
        ]
      })
  },
  {
    name: 'Virtual Boy',
    category: 'console',
    hint: 'Four shades of red on black, 128 px, Bayer dithering between the two nearest shades.',
    build: () =>
      build({
        stages: [
          ['adjust', { saturation: -1, contrast: 0.25 }],
          ['downscale', { longest: 128, method: 'box' }],
          [
            'dither',
            { pattern: 'bayer4', mixing: 'two-nearest', strength: 1 },
            { palette: { name: 'Virtual Boy', colors: ['#000000', '#550000', '#aa0000', '#ff0000'] } }
          ]
        ]
      })
  },
  {
    name: 'PICO-8',
    category: 'console',
    hint: "The fantasy console: 128 px, PICO-8's 16 colors, Knoll pattern dithering for accurate shades.",
    build: () =>
      build({
        stages: [
          ['downscale', { longest: 128, method: 'box' }],
          ['dither', { pattern: 'bayer8', mixing: 'knoll', knollCount: 4, strength: 1 }, { palette: 'PICO-8' }]
        ]
      })
  },

  // ── Computers ─────────────────────────────────────────────────────────────
  {
    name: 'CGA',
    category: 'computer',
    hint: 'IBM PC CGA mode 4: black, cyan, magenta and white, 2×2 Bayer at 128 px.',
    build: () =>
      build({
        stages: [
          ['adjust', { contrast: 0.2 }],
          ['downscale', { longest: 128, method: 'box' }],
          ['dither', { pattern: 'bayer2', mixing: 'two-nearest', strength: 1 }, { palette: 'CGA mode 4 (palette 1, high)' }]
        ]
      })
  },
  {
    name: 'EGA',
    category: 'computer',
    hint: "The PC's 16 EGA colors, 4×4 Bayer at 160 px.",
    build: () =>
      build({
        stages: [
          ['adjust', { saturation: 0.15 }],
          ['downscale', { longest: 160, method: 'box' }],
          ['dither', { pattern: 'bayer4', strength: 0.8 }, { palette: 'CGA (16)' }]
        ]
      })
  },
  {
    name: 'VGA 256',
    category: 'computer',
    hint:
      'DOS mode 13h: 256 colors picked from 18-bit color (64 levels per channel), with the light ' +
      'Floyd–Steinberg of 90s games. 256 px, Lanczos downscale.',
    build: () =>
      build({
        stages: [
          ['downscale', { longest: 256, method: 'lanczos' }],
          ['dither', { pattern: 'floyd-steinberg', strength: 0.6, serpentine: true, wrap: true }, { colors: 256 }],
          ['quantize', { mode: 'levels', levels: 64 }]
        ]
      })
  },
  {
    name: 'Commodore 64',
    category: 'computer',
    hint: 'The C64\'s 16 fixed colors with its typical checkerboard dithering, 128 px.',
    build: () =>
      build({
        stages: [
          ['downscale', { longest: 128, method: 'box' }],
          ['dither', { pattern: 'checker', mixing: 'two-nearest', strength: 1 }, { palette: 'Commodore 64' }]
        ]
      })
  },
  {
    name: 'Classic Mac',
    category: 'computer',
    hint: '1-bit black and white with Atkinson dithering, the Mac\'s own: highlights and shadows stay clean. 256 px.',
    build: () =>
      build({
        stages: [
          ['adjust', { contrast: 0.1 }],
          ['downscale', { longest: 256, method: 'lanczos' }],
          ['dither', { pattern: 'atkinson', strength: 1, wrap: true }, { palette: '1-bit' }]
        ]
      })
  },

  // ── Stylized ──────────────────────────────────────────────────────────────
  {
    name: 'Crunchy',
    category: 'stylized',
    hint: 'Sharpened, 64 px contrast-aware downscale, 8 colors, heavy 2×2 dither.',
    build: () =>
      build({
        stages: [
          ['adjust', { sharpen: 1, contrast: 0.25, saturation: 0.2 }],
          ['downscale', { longest: 64, method: 'contrast', detail: 0.6 }],
          ['dither', { pattern: 'bayer2', twoNearest: true, strength: 1 }, { colors: 8 }]
        ]
      })
  },
  {
    name: 'Pixelate',
    category: 'stylized',
    hint: 'Chunky pixels at the original size: 64 px dominant-color downscale, 16 colors, scaled back up with Nearest.',
    build: () =>
      build({
        stages: [
          ['downscale', { longest: 64, method: 'dominant' }],
          ['quantize', {}, { colors: 16, generator: { method: 'octree' } }],
          ['upscale', { method: 'nearest', sizeMode: 'source' }]
        ]
      })
  },
  {
    name: 'Painted pixels',
    category: 'stylized',
    hint: 'Edge-preserving downscale to 96 px, 12 flat colors, then Scale2x (EPX) for smooth pixel-art diagonals.',
    build: () =>
      build({
        stages: [
          ['adjust', { saturation: 0.25 }],
          ['downscale', { longest: 96, method: 'kuwahara' }],
          ['quantize', {}, { colors: 12, generator: { method: 'wu' } }],
          ['upscale', { method: 'epx', sizeMode: 'factor', factor: 2 }]
        ]
      })
  },
  {
    name: 'Clean edges',
    category: 'stylized',
    hint: 'Dithers only smooth gradients (a Flats mask); edges and details stay crisp. 128 px, 24 colors, Bayer 8×8.',
    build: () =>
      build({
        stages: [
          ['downscale', { longest: 128, method: 'lanczos' }],
          ['dither', { pattern: 'bayer8', strength: 0.8, mask: 'flats', maskBlur: 1, wrap: true }, { colors: 24, generator: { method: 'octree' } }]
        ]
      })
  },
  {
    name: 'Blue-noise grain',
    category: 'stylized',
    hint: 'Film-like color grain: blue-noise dither with each channel on its own phase, 256 px, 32 colors weighted toward the shadows.',
    build: () =>
      build({
        stages: [
          ['downscale', { longest: 256, method: 'bicubic' }],
          ['dither', { pattern: 'blue-noise', strength: 0.6, saturation: 1 }, { colors: 32, generator: { gamma: 1.4 } }]
        ]
      })
  },
  {
    name: 'Newsprint',
    category: 'stylized',
    hint: 'Grayscale 45° halftone dots, ink on paper, with the pattern scaled ×2. 256 px.',
    build: () =>
      build({
        stages: [
          ['adjust', { saturation: -1, contrast: 0.25 }],
          ['downscale', { longest: 256, method: 'box' }],
          ['dither', { pattern: 'halftone', scale: 2, strength: 1 }, { palette: { name: 'Newsprint', colors: ['#1a1a1a', '#f2ecdf'] } }]
        ]
      })
  },
  {
    name: 'Etching',
    category: 'stylized',
    hint: 'Sepia two-tone: crosshatching where the image has detail, diagonal lines in the flat areas (a mask with a second pattern).',
    build: () =>
      build({
        stages: [
          ['adjust', { saturation: -1, contrast: 0.3, sharpen: 0.5 }],
          ['downscale', { longest: 256, method: 'lanczos' }],
          [
            'dither',
            { pattern: 'crosshatch', strength: 1, mask: 'edges', maskBlur: 1, outsidePattern: 'lines-d', outsideStrength: 1, wrap: true },
            { palette: { name: 'Sepia ink', colors: ['#2b1d14', '#efe2c8'] } }
          ]
        ]
      })
  },
  {
    name: 'Comic ink',
    category: 'stylized',
    hint: 'Black ink on the edges (an Adjust stage blended through an edge mask), then 8 flat colors. 256 px median downscale.',
    build: () =>
      build({
        stages: [
          ['downscale', { longest: 256, method: 'median' }],
          ['adjust', { outWhite: 0 }, { blend: { opacity: 0.8, mask: { a: 'edges', wrap: true } } }],
          ['quantize', {}, { colors: 8, generator: { method: 'wu', chromaWeight: 1.5 } }]
        ]
      })
  },
  {
    name: 'Sunset gradient',
    category: 'stylized',
    hint: 'A gradient map: the image in grayscale, dithered onto five sunset colors with Knoll mixing. 128 px.',
    build: () =>
      build({
        stages: [
          ['adjust', { saturation: -1, contrast: 0.15 }],
          ['downscale', { longest: 128, method: 'box' }],
          [
            'dither',
            { pattern: 'bayer8', mixing: 'knoll', knollCount: 4, strength: 1 },
            { palette: { name: 'Sunset', colors: ['#1b0f2e', '#5b1e5e', '#c2415a', '#f4a259', '#fbe7a1'] } }
          ]
        ]
      })
  },
  {
    name: 'Grime',
    category: 'stylized',
    hint:
      'Needs AO and cavity maps (Maps panel, or bake them from a model): shades the texture with them, then ' +
      'dithers harder in the occluded crevices. 128 px, 24 colors.',
    build: () =>
      build({
        stages: [
          ['adjust', { ao: 0.6, cavity: 0.8, contrast: 0.1 }],
          ['downscale', { longest: 128, method: 'box' }],
          ['dither', { pattern: 'blue-noise', strength: 1, mask: 'map-ao', maskInvert: true, maskStrength: 0.7 }, { colors: 24 }]
        ]
      })
  },
  {
    name: 'Dithered cutout',
    category: 'stylized',
    hint: 'For foliage, hair and fences: soft alpha becomes a blue-noise on/off cutout. 128 px, 32 colors.',
    build: () =>
      build({
        stages: [
          ['downscale', { longest: 128, pot: true, method: 'box' }],
          ['dither', { pattern: 'blue-noise', strength: 0.5, alpha: 'dither' }, { colors: 32 }]
        ]
      })
  },
  {
    name: 'Seamless tiling',
    category: 'stylized',
    hint: 'For tiling textures: 128 px power of two, Floyd–Steinberg that carries its error across the edges, so it tiles without seams.',
    build: () =>
      build({
        stages: [
          ['downscale', { longest: 128, pot: true, method: 'box' }],
          ['dither', { pattern: 'floyd-steinberg', strength: 0.8, wrap: true }, { colors: 16 }]
        ]
      })
  }
]
