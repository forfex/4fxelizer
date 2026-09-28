// Settings UI for each stage type, plus the shared blend row.

import { useEffect, useMemo, useRef } from 'react'
import { BLEND_MODES, type BlendMode } from '@/gpu/pass'
import { DEFAULT_ADJUST, type AdjustParams } from '@/gpu/passes/adjust'
import {
  DITHER_MASKS,
  DITHER_MIXING,
  DITHER_MODES,
  DITHER_PATTERNS,
  ditherMask,
  ditherMixing,
  isDiffusion,
  usesPattern,
  type DitherMask,
  type DitherParams,
  type DitherPattern
} from '@/gpu/passes/dither'
import { MASK_COMBINE, maskMapSlot, MAX_MASK_BLUR } from '@/gpu/mask'
import { decodePattern } from '@/dither/customPattern'
import { loadPatternImage } from '@/actions'
import { DOWNSCALE_METHODS, type DownscaleParams } from '@/gpu/passes/downscale'
import type { ColorMetric, QuantizeParams } from '@/gpu/passes/quantize'
import { MAX_UPSCALE_FACTOR, UPSCALE_METHODS, type UpscaleParams } from '@/gpu/passes/upscale'
import type { StageSpec } from '@/gpu/plan'
import { GENERATE_METHODS, MAX_PALETTE, type GeneratorSettings, type Palette } from '@/palette/palette'
import type { StageInfo } from '@/stack/analyze'
import { ownedPalette } from '@/stack/doc'
import { useApp } from '@/store'
import { Button } from '../ui/button'
import { Checkbox, Field, NumberField, ParamSlider, Segmented } from '../ui/controls'
import { Led } from '../ui/retro'
import { Select } from '../ui/select'

interface EditorProps<P> {
  stage: StageSpec
  params: P
  set(patch: Partial<P>): void
  info: StageInfo | undefined
}

const METRICS: { value: ColorMetric; label: string; hint: string }[] = [
  { value: 'oklab', label: 'Perceptual', hint: 'Match colors as the eye sees them (OKLab). Usually best.' },
  { value: 'rgb', label: 'RGB', hint: 'Plain RGB distance, like most older tools.' }
]

/** Most swatches a strip draws; larger palettes are sampled evenly. */
const STRIP_MAX = 128

/** Thin row of a palette's colors; click to open the palette in the palette panel. */
export function PaletteStrip({ palette }: { palette: Palette }) {
  if (!palette.colors.length) return null
  const step = Math.max(1, palette.colors.length / STRIP_MAX)
  const shown = Array.from({ length: Math.min(palette.colors.length, STRIP_MAX) }, (_, i) => palette.colors[Math.floor(i * step)]!)
  return (
    <button
      type="button"
      className="bevel-sunken flex h-2.5 w-full overflow-hidden rounded-[2px] border-px border-edge"
      title="Edit this palette"
      onClick={() => useApp.getState().selectPalette(palette.id)}
    >
      {shown.map((c, i) => (
        <span key={i} className="h-full flex-1" style={{ backgroundColor: c.hex }} />
      ))}
    </button>
  )
}

export function PaletteSelect({ value, onChange }: { value: string | null; onChange(id: string): void }) {
  const palettes = useApp((s) => s.palettes)
  const palette = palettes.find((p) => p.id === value)
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <Select
        className="w-full"
        value={palette ? value : null}
        placeholder="Pick a palette…"
        onValueChange={onChange}
        options={palettes.map((p) => ({ value: p.id, label: `${p.name} (${p.colors.length})` }))}
      />
      {palette && <PaletteStrip palette={palette} />}
    </div>
  )
}

/**
 * Where a palette stage gets its colors: a project palette, or its own palette generated from its
 * input (count and method right here; everything else in the palette panel).
 */
function PaletteSource({ stage, paletteId, set }: { stage: StageSpec; paletteId: string | null; set(p: { paletteId: string }): void }) {
  const owned = useApp((s) => ownedPalette(s, stage.uid))
  const job = useApp((s) => (owned ? s.paletteJobs[owned.id] : undefined))
  const generated = !!owned && owned.id === paletteId
  const gen = owned?.generator
  const updateGen = (patch: Partial<GeneratorSettings>): void => {
    if (owned && gen) {
      useApp.getState().updatePalette(owned.id, { generator: { ...gen, ...patch } }, { coalesce: `gen:${owned.id}:${Object.keys(patch)}` })
    }
  }
  return (
    <>
      <Field label="Colors from">
        <Segmented
          className="flex-1"
          value={generated ? 'generated' : 'palette'}
          onChange={(v) => useApp.getState().setStagePaletteSource(stage.uid, v)}
          options={[
            { value: 'palette', label: 'Palette', hint: 'Use a project palette (built-in, imported or edited).' },
            { value: 'generated', label: 'Generated', hint: "Generate a palette from this stage's input automatically." }
          ]}
        />
      </Field>
      {generated && owned && gen ? (
        <>
          <ParamSlider
            label="Colors"
            hint="Number of colors to generate from this stage's input (2–8192)."
            scale="log"
            value={gen.count}
            min={2}
            max={MAX_PALETTE}
            onChange={(count) => updateGen({ count })}
          />
          <Field label="Method" hint={GENERATE_METHODS.find((m) => m.id === gen.method)?.hint}>
            <Select
              className="flex-1"
              value={gen.method}
              onValueChange={(method) => updateGen({ method })}
              options={GENERATE_METHODS.map((m) => ({ value: m.id, label: m.label, hint: m.hint }))}
            />
          </Field>
          <Field label="" hint="More settings (weights, locked colors) in the palette panel.">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <PaletteStrip palette={owned} />
              <span className="flex items-center gap-1.5 text-small text-dim">
                {job ? (
                  <>
                    <Led state={job.status === 'running' ? 'warn' : 'error'} />
                    <span className="truncate" title={'message' in job ? job.message : undefined}>
                      {job.status === 'running' ? 'Generating…' : job.message}
                    </span>
                  </>
                ) : (
                  `${owned.colors.length} colors · click the strip for more settings`
                )}
              </span>
            </div>
          </Field>
        </>
      ) : (
        <Field label="Palette">
          <PaletteSelect value={paletteId} onChange={(id) => set({ paletteId: id })} />
        </Field>
      )}
    </>
  )
}

function AdjustEditor({ params: p, set }: EditorProps<AdjustParams>) {
  return (
    <>
      <ParamSlider label="Brightness" value={p.brightness} min={-1} max={1} step={0.01} onChange={(brightness) => set({ brightness })} />
      <ParamSlider label="Contrast" value={p.contrast} min={-1} max={1} step={0.01} onChange={(contrast) => set({ contrast })} />
      <ParamSlider label="Gamma" hint="Midtones: above 1 brightens, below 1 darkens." value={p.gamma} min={0.2} max={3} step={0.01} onChange={(gamma) => set({ gamma })} />
      <ParamSlider label="Saturation" value={p.saturation} min={-1} max={1} step={0.01} onChange={(saturation) => set({ saturation })} />
      <ParamSlider label="Hue" value={p.hue} min={-180} max={180} step={1} suffix="°" onChange={(hue) => set({ hue })} />
      <ParamSlider label="Sharpen" hint="Unsharp mask before everything else. Helps details survive downscaling." value={p.sharpen} min={0} max={3} step={0.05} onChange={(sharpen) => set({ sharpen })} />
      <Field label="Input levels" hint="Black and white points of the input.">
        <NumberField className="flex-1" value={p.inBlack} min={0} max={1} step={0.01} onChange={(inBlack) => set({ inBlack })} />
        <NumberField className="flex-1" value={p.inWhite} min={0} max={1} step={0.01} onChange={(inWhite) => set({ inWhite })} />
      </Field>
      <Field label="Output levels" hint="Darkest and brightest output values.">
        <NumberField className="flex-1" value={p.outBlack} min={0} max={1} step={0.01} onChange={(outBlack) => set({ outBlack })} />
        <NumberField className="flex-1" value={p.outWhite} min={0} max={1} step={0.01} onChange={(outWhite) => set({ outWhite })} />
      </Field>
      <div className="flex justify-end">
        <Button size="sm" onClick={() => set(DEFAULT_ADJUST)}>Reset</Button>
      </div>
    </>
  )
}

const SIZE_PRESETS = [32, 64, 128, 256]

function DownscaleEditor({ params: p, set, info }: EditorProps<DownscaleParams>) {
  const method = DOWNSCALE_METHODS.find((m) => m.id === p.method)
  return (
    <>
      <Field label="Method" hint={method?.hint}>
        <Select
          className="flex-1"
          value={p.method}
          onValueChange={(m) => set({ method: m })}
          options={DOWNSCALE_METHODS.map((m) => ({ value: m.id, label: m.label, hint: m.hint }))}
        />
      </Field>
      <Field label="Size">
        <Segmented
          className="flex-1"
          value={p.sizeMode}
          onChange={(sizeMode) => set({ sizeMode })}
          options={[
            { value: 'longest', label: 'Longest', hint: 'Longest side in pixels; keeps the aspect ratio.' },
            { value: 'exact', label: 'W × H', hint: 'Exact width and height.' },
            { value: 'scale', label: 'Scale', hint: 'Percentage of the input size.' }
          ]}
        />
      </Field>
      {p.sizeMode === 'longest' && (
        <Field label="">
          <NumberField className="w-16 shrink-0" value={p.longest} min={1} max={8192} onChange={(longest) => set({ longest })} suffix="px" />
          <div className="flex min-w-32 flex-1 gap-0.5">
            {SIZE_PRESETS.map((n) => (
              <Button key={n} size="sm" className="min-w-0 flex-1 px-0 font-mono text-[10px]" aria-pressed={p.longest === n} onClick={() => set({ longest: n })}>
                {n}
              </Button>
            ))}
          </div>
        </Field>
      )}
      {p.sizeMode === 'exact' && (
        <Field label="">
          <NumberField className="flex-1" value={p.width} min={1} max={8192} onChange={(width) => set({ width })} suffix="w" />
          <span className="text-dim">×</span>
          <NumberField className="flex-1" value={p.height} min={1} max={8192} onChange={(height) => set({ height })} suffix="h" />
        </Field>
      )}
      {p.sizeMode === 'scale' && (
        <ParamSlider label="" value={Math.round(p.scale * 100)} min={1} max={100} suffix="%" onChange={(v) => set({ scale: v / 100 })} />
      )}
      <Field label="">
        <Checkbox
          checked={p.pot}
          onCheckedChange={(pot) => set({ pot })}
          label="Power of two"
          hint="Round each side to the nearest power of two (PSX textures: up to 256×256)."
        />
      </Field>
      {info && info.input.width > 0 && (
        <Field label="Result" hint="Input → output size">
          <span className="font-mono text-small">
            {info.input.width}×{info.input.height} → {info.output.width}×{info.output.height}
          </span>
        </Field>
      )}
      {p.method === 'dominant' && (
        <ParamSlider label="Tolerance" hint="How similar colors must be to count as the same color." value={p.tolerance} min={0.01} max={0.3} step={0.01} onChange={(tolerance) => set({ tolerance })} />
      )}
      {p.method === 'contrast' && (
        <ParamSlider label="Detail" hint="How strongly dark texels win over the average." value={p.detail} min={0} max={1} step={0.01} onChange={(detail) => set({ detail })} />
      )}
    </>
  )
}

function UpscaleEditor({ params: p, set, info }: EditorProps<UpscaleParams>) {
  const method = UPSCALE_METHODS.find((m) => m.id === p.method)
  return (
    <>
      <Field label="Filter" hint={method?.hint}>
        <Select
          className="flex-1"
          value={p.method}
          onValueChange={(m) => set({ method: m })}
          options={UPSCALE_METHODS.map((m) => ({ value: m.id, label: m.label, hint: m.hint }))}
        />
      </Field>
      <Field label="Size">
        <Segmented
          className="flex-1"
          value={p.sizeMode}
          onChange={(sizeMode) => set({ sizeMode })}
          options={[
            { value: 'factor', label: 'Factor', hint: 'Multiply the input size.' },
            { value: 'source', label: 'Original', hint: 'Back to the size of the loaded image.' }
          ]}
        />
      </Field>
      {p.sizeMode === 'factor' && (
        <ParamSlider label="" value={p.factor} min={2} max={MAX_UPSCALE_FACTOR} onChange={(factor) => set({ factor })} suffix="×" />
      )}
      <Field label="">
        <Checkbox
          checked={p.wrap}
          onCheckedChange={(wrap) => set({ wrap })}
          label="Wrap edges (tiling)"
          hint="Blend across the edges as if the texture repeats, so tiling textures have no seams."
        />
      </Field>
      {info && info.input.width > 0 && (
        <Field label="Result" hint="Input → output size">
          <span className="font-mono text-small">
            {info.input.width}×{info.input.height} → {info.output.width}×{info.output.height}
          </span>
        </Field>
      )}
    </>
  )
}

function LevelsSlider({ value, onChange }: { value: number; onChange(v: number): void }) {
  const bits = Math.log2(value)
  return (
    <ParamSlider
      label="Levels"
      hint="Levels per channel. 32 = 5 bits per channel (PSX 15-bit color)."
      value={value}
      min={2}
      max={256}
      onChange={onChange}
      suffix={Number.isInteger(bits) ? `${bits}b` : undefined}
    />
  )
}

function QuantizeEditor({ stage, params: p, set }: EditorProps<QuantizeParams>) {
  return (
    <>
      <Field label="Mode">
        <Segmented
          className="flex-1"
          value={p.mode}
          onChange={(mode) => set({ mode })}
          options={[
            { value: 'palette', label: 'Palette', hint: 'Snap every pixel to the nearest palette color.' },
            { value: 'levels', label: 'Levels', hint: 'Snap each channel to N evenly spaced levels.' }
          ]}
        />
      </Field>
      {p.mode === 'palette' ? (
        <>
          <PaletteSource stage={stage} paletteId={p.paletteId} set={set} />
          <Field label="Matching">
            <Segmented className="flex-1" value={p.metric} onChange={(metric) => set({ metric })} options={METRICS} />
          </Field>
        </>
      ) : (
        <LevelsSlider value={p.levels} onChange={(levels) => set({ levels })} />
      )}
      <Field label="Alpha">
        <Segmented
          className="flex-1"
          value={p.alpha}
          onChange={(alpha) => set({ alpha })}
          options={[
            { value: 'keep', label: 'Keep' },
            { value: 'binary', label: 'Cutout', hint: 'Fully opaque or fully transparent, like PSX textures.' }
          ]}
        />
      </Field>
      {p.alpha === 'binary' && (
        <ParamSlider label="Threshold" value={p.alphaThreshold} min={0} max={1} step={0.01} onChange={(alphaThreshold) => set({ alphaThreshold })} />
      )}
    </>
  )
}

/** Saturation that fits each kind of algorithm: ordered = brightness only, diffusion = full color. */
const defaultSaturation = (pattern: DitherPattern): number => (isDiffusion(pattern) ? 1 : 0)

function DitherEditor({ stage, params: p, set }: EditorProps<DitherParams>) {
  const diffusion = isDiffusion(p.pattern)
  const mixing = ditherMixing(p)

  const setPattern = (pattern: DitherPattern): void => {
    const patch: Partial<DitherParams> = { pattern }
    // Switching between ordered and diffusion: carry an untouched saturation over to the new default.
    if (isDiffusion(pattern) !== diffusion && p.saturation === defaultSaturation(p.pattern)) {
      patch.saturation = defaultSaturation(pattern)
    }
    set(patch)
  }

  // Ordered patterns first (list order is the shader index, so newer ordered ones come after diffusion).
  const sorted = [...DITHER_PATTERNS].sort((a, b) => Number(a.kind === 'diffusion') - Number(b.kind === 'diffusion'))
  const patterns = sorted.filter((d) => p.mode !== 'pattern' || d.kind === 'ordered').map((d) => ({
    value: d.id,
    label: d.label,
    group: d.kind === 'ordered' ? 'Ordered (tiles)' : 'Error diffusion'
  }))

  return (
    <>
      <Field label="Mode" hint={DITHER_MODES.find((m) => m.id === p.mode)?.hint}>
        <Segmented
          className="flex-1"
          value={p.mode}
          onChange={(mode) => {
            // Pattern only can't diffuse error: fall back to ordered patterns.
            const patch: Partial<DitherParams> = mode === 'pattern' && diffusion ? { mode, pattern: 'bayer4', saturation: 0 } : { mode }
            if (mode === 'pattern' && p.outsidePattern !== 'none' && isDiffusion(p.outsidePattern)) patch.outsidePattern = 'none'
            set(patch)
          }}
          options={DITHER_MODES.map((m) => ({ value: m.id, label: m.label, hint: m.hint }))}
        />
      </Field>
      <Field
        label="Algorithm"
        hint={
          diffusion
            ? 'Error diffusion spreads each pixel\'s rounding error to its neighbors: smooth and organic. Turn on Wrap edges for tiling textures.'
            : 'Ordered patterns compare each pixel with a repeating threshold pattern: crisp, retro, tileable.'
        }
      >
        <Select className="flex-1" value={p.pattern} onValueChange={setPattern} options={patterns} />
      </Field>
      {p.mode === 'palette' && (
        <>
          <PaletteSource stage={stage} paletteId={p.paletteId} set={set} />
          <Field label="Matching">
            <Segmented className="flex-1" value={p.metric} onChange={(metric) => set({ metric })} options={METRICS} />
          </Field>
          {!diffusion && (
            <Field label="Mixing" hint={DITHER_MIXING.find((m) => m.id === mixing)?.hint}>
              <Segmented
                className="flex-1"
                value={mixing}
                onChange={(m) => set({ mixing: m, twoNearest: false })}
                options={DITHER_MIXING.map((m) => ({ value: m.id, label: m.label, hint: m.hint }))}
              />
            </Field>
          )}
          {!diffusion && mixing === 'knoll' && (
            <ParamSlider
              label="Candidates"
              hint="Palette colors mixed per pixel. More = finer shades, slower."
              value={p.knollCount}
              min={2}
              max={16}
              onChange={(knollCount) => set({ knollCount })}
            />
          )}
        </>
      )}
      {p.mode === 'levels' && <LevelsSlider value={p.levels} onChange={(levels) => set({ levels })} />}
      <ParamSlider label="Strength" value={p.strength} min={0} max={1} step={0.01} onChange={(strength) => set({ strength })} />
      {(diffusion || p.mode !== 'palette' || mixing === 'offset') && (
        <ParamSlider
          label="Saturation"
          hint={
            diffusion
              ? 'How much color error spreads. 0 = only brightness is dithered (hues stay flat), 1 = full color.'
              : 'Color of the dither. 0 = same pattern on every channel (brightness only), 1 = each channel dithered separately, mixing hues.'
          }
          value={p.saturation}
          min={0}
          max={1}
          step={0.01}
          onChange={(saturation) => set({ saturation })}
        />
      )}
      {diffusion && (
        <Field label="">
          <Checkbox
            checked={p.serpentine}
            onCheckedChange={(serpentine) => set({ serpentine })}
            label="Serpentine"
            hint="Every other row runs right to left, which breaks up the diagonal streaks error diffusion leaves."
          />
        </Field>
      )}
      {!diffusion && (
        <ParamSlider label="Pattern scale" hint="Pixels per pattern cell." value={p.scale} min={1} max={8} ticks={8} onChange={(scale) => set({ scale })} suffix="×" />
      )}
      {usesPattern(p, 'custom') && <PatternImageField stage={stage} params={p} />}
      <Field label="Tiling">
        <Checkbox
          checked={p.wrap}
          onCheckedChange={(wrap) => set({ wrap })}
          label="Wrap edges"
          hint={
            'For tiling textures: error diffusion carries error across the edges (slower on large images), ' +
            'and mask edge detection and blur wrap around.'
          }
        />
      </Field>
      <DitherMaskSettings stage={stage} params={p} set={set} patterns={patterns} />
      <Field label="Alpha">
        <Segmented
          className="flex-1"
          value={p.alpha}
          onChange={(alpha) => set({ alpha })}
          options={[
            { value: 'keep', label: 'Keep' },
            { value: 'dither', label: 'Dithered cutout', hint: 'Alpha becomes 0 or 1 using the pattern.' }
          ]}
        />
      </Field>
    </>
  )
}

/** Custom dither pattern: a preview of the image and a button to load another. */
function PatternImageField({ stage, params: p }: { stage: StageSpec; params: DitherParams }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pattern = useMemo(() => decodePattern(p.customPattern), [p.customPattern])
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !pattern) return
    canvas.width = pattern.width
    canvas.height = pattern.height
    const pixels = ctx.createImageData(pattern.width, pattern.height)
    pattern.gray.forEach((v, i) => pixels.data.set([v, v, v, 255], i * 4))
    ctx.putImageData(pixels, 0, 0)
  }, [pattern])
  return (
    <Field label="Pattern" hint="Any small grayscale image: darker pixels turn dark first. It repeats across the image.">
      <div className="bevel-sunken flex size-8 shrink-0 items-center justify-center overflow-hidden bg-well">
        {pattern ? <canvas ref={canvasRef} className="size-full [image-rendering:pixelated]" /> : <span className="text-small text-dim">—</span>}
      </div>
      <span className="min-w-0 flex-1 truncate text-small text-dim" title={p.customPatternName}>
        {pattern ? `${p.customPatternName || 'Pattern'} · ${pattern.width}×${pattern.height}` : 'No image loaded'}
      </span>
      <Button size="sm" onClick={() => void loadPatternImage(stage.uid)}>
        Load…
      </Button>
    </Field>
  )
}

const MASK_OPTIONS = DITHER_MASKS.map((m) => ({ value: m.id, label: m.label, hint: m.hint, group: m.group }))

/** Mask source dropdown with an Invert switch. */
function MaskSourceField({
  label,
  hint,
  value,
  invert,
  onChange,
  onInvert,
  none,
  children
}: {
  label: string
  hint: string
  value: DitherMask
  invert: boolean
  onChange(value: DitherMask): void
  onInvert(invert: boolean): void
  /** Label of the 'none' option. */
  none: string
  children?: React.ReactNode
}) {
  const maps = useApp((s) => s.maps)
  const options = MASK_OPTIONS.map((o) => {
    if (o.value === 'none') return { ...o, label: none }
    const slot = maskMapSlot(o.value)
    return slot && !maps[slot] ? { ...o, label: `${o.label} (not loaded)` } : o
  })
  return (
    <Field label={label} hint={DITHER_MASKS.find((m) => m.id === value)?.hint ?? hint}>
      <Select className="min-w-28 flex-1" value={value} onValueChange={onChange} options={options} />
      <Checkbox checked={invert} disabled={value === 'none'} onCheckedChange={onInvert} label="Inv" hint="Invert: swap white and black." />
      {children}
    </Field>
  )
}

/** Where the dither goes: up to two mask sources, combined, blurred and shaped, and the pattern outside. */
function DitherMaskSettings({
  stage,
  params: p,
  set,
  patterns
}: Omit<EditorProps<DitherParams>, 'info'> & { patterns: { value: DitherPattern; label: string; group: string }[] }) {
  const maskShown = useApp((s) => s.maskUid === stage.uid)
  const { setMaskView } = useApp.getState()
  const hasMask = ditherMask(p) !== null
  const update = (patch: Partial<DitherParams>): void => {
    set(patch)
    if (maskShown && !ditherMask({ ...p, ...patch })) setMaskView(null)
  }
  return (
    <>
      <MaskSourceField
        label="Mask"
        hint="Where to dither. White = full dither, black = none (or the outside pattern)."
        value={p.mask}
        invert={p.maskInvert}
        onChange={(mask) => update({ mask })}
        onInvert={(maskInvert) => set({ maskInvert })}
        none="Everywhere"
      >
        <Button
          size="sm"
          aria-pressed={maskShown}
          disabled={!hasMask}
          title={maskShown ? 'Showing the mask (white = full dither). Click to show the image.' : 'Show the mask in the viewer (white = full dither, black = none)'}
          onClick={() => setMaskView(maskShown ? null : stage.uid)}
        >
          View
        </Button>
      </MaskSourceField>
      {(hasMask || p.mask2 !== 'none') && (
        <MaskSourceField
          label="Combine with"
          hint="A second mask source, combined with the first."
          value={p.mask2}
          invert={p.mask2Invert}
          onChange={(mask2) => update({ mask2 })}
          onInvert={(mask2Invert) => set({ mask2Invert })}
          none="Nothing"
        />
      )}
      {p.mask !== 'none' && p.mask2 !== 'none' && (
        <Field label="" hint={MASK_COMBINE.find((m) => m.id === p.maskCombine)?.hint}>
          <Segmented
            className="flex-1"
            value={p.maskCombine}
            onChange={(maskCombine) => set({ maskCombine })}
            options={MASK_COMBINE.map((m) => ({ value: m.id, label: m.label, hint: m.hint }))}
          />
        </Field>
      )}
      {hasMask && (
        <>
          <ParamSlider
            label="Mask blur"
            hint="Softens the mask, in pixels of this stage's image."
            value={p.maskBlur}
            min={0}
            max={MAX_MASK_BLUR}
            step={0.5}
            onChange={(maskBlur) => set({ maskBlur })}
            suffix="px"
          />
          <ParamSlider
            label="Mask strength"
            hint="0 = ignore the mask, 1 = dither only where the mask is white."
            value={p.maskStrength}
            min={0}
            max={1}
            step={0.01}
            onChange={(maskStrength) => set({ maskStrength })}
          />
          <ParamSlider
            label="Mask gamma"
            hint="Below 1 spreads the mask wider, above 1 keeps it to the strongest areas."
            value={p.maskGamma}
            min={0.1}
            max={10}
            step={0.01}
            scale="log"
            onChange={(maskGamma) => set({ maskGamma })}
          />
          <Field label="Outside" hint="Pattern where the mask is dark (below 50%). Same = the same pattern, weaker there.">
            <Select
              className="min-w-0 flex-1"
              value={p.outsidePattern}
              onValueChange={(outsidePattern) => set({ outsidePattern })}
              options={[{ value: 'none' as const, label: 'Same pattern' }, ...patterns]}
            />
          </Field>
          {p.outsidePattern !== 'none' && (
            <ParamSlider
              label="Outside strength"
              hint="Dither strength of the outside pattern."
              value={p.outsideStrength}
              min={0}
              max={1}
              step={0.01}
              onChange={(outsideStrength) => set({ outsideStrength })}
            />
          )}
        </>
      )}
    </>
  )
}

const EDITORS: Record<string, (props: EditorProps<never>) => React.JSX.Element> = {
  adjust: AdjustEditor as never,
  downscale: DownscaleEditor as never,
  upscale: UpscaleEditor as never,
  quantize: QuantizeEditor as never,
  dither: DitherEditor as never
}

export function StageEditor({ stage, info }: { stage: StageSpec; info: StageInfo | undefined }) {
  const Editor = EDITORS[stage.passId]
  if (!Editor) return <p className="text-dim">No settings.</p>
  const set = (patch: object): void => useApp.getState().updateParams(stage.uid, patch)
  return <Editor stage={stage} params={stage.params as never} set={set} info={info} />
}

export function BlendRow({ stage }: { stage: StageSpec }) {
  const update = (blend: Partial<StageSpec['blend']>): void =>
    useApp.getState().updateStage(stage.uid, { blend: { ...stage.blend, ...blend } }, `blend:${stage.uid}:${Object.keys(blend)}`)
  return (
    <>
      <ParamSlider
        label="Opacity"
        hint="How much of this stage's result is blended over its input."
        value={Math.round(stage.blend.opacity * 100)}
        min={0}
        max={100}
        suffix="%"
        onChange={(v) => update({ opacity: v / 100 })}
      />
      <Field label="Blend">
        <Select
          className="flex-1"
          value={stage.blend.mode}
          onValueChange={(mode: BlendMode) => update({ mode })}
          options={BLEND_MODES.map((m) => ({ value: m.id, label: m.label }))}
        />
      </Field>
    </>
  )
}
