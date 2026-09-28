// Settings UI for each stage type, plus the shared blend row.

import { BLEND_MODES, type BlendMode } from '@/gpu/pass'
import { DEFAULT_ADJUST, type AdjustParams } from '@/gpu/passes/adjust'
import { DITHER_MODES, DITHER_PATTERNS, type DitherParams } from '@/gpu/passes/dither'
import { DOWNSCALE_METHODS, type DownscaleParams } from '@/gpu/passes/downscale'
import type { ColorMetric, QuantizeParams } from '@/gpu/passes/quantize'
import type { StageSpec } from '@/gpu/plan'
import type { StageInfo } from '@/stack/analyze'
import { useApp } from '@/store'
import { Button } from '../ui/button'
import { Checkbox, Field, NumberField, ParamSlider, Segmented } from '../ui/controls'
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
      {palette && palette.colors.length > 0 && (
        <button
          type="button"
          className="bevel-sunken flex h-2.5 overflow-hidden"
          title="Edit this palette"
          onClick={() => useApp.getState().selectPalette(palette.id)}
        >
          {palette.colors.map((c, i) => (
            <span key={i} className="h-full flex-1" style={{ backgroundColor: c.hex }} />
          ))}
        </button>
      )}
    </div>
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
          <div className="flex min-w-0 flex-1 gap-px">
            {SIZE_PRESETS.map((n) => (
              <Button key={n} size="sm" className="min-w-0 flex-1 px-0" aria-pressed={p.longest === n} onClick={() => set({ longest: n })}>
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

function QuantizeEditor({ params: p, set }: EditorProps<QuantizeParams>) {
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
          <Field label="Palette">
            <PaletteSelect value={p.paletteId} onChange={(paletteId) => set({ paletteId })} />
          </Field>
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

function DitherEditor({ params: p, set }: EditorProps<DitherParams>) {
  return (
    <>
      <Field label="Mode" hint={DITHER_MODES.find((m) => m.id === p.mode)?.hint}>
        <Segmented
          className="flex-1"
          value={p.mode}
          onChange={(mode) => set({ mode })}
          options={DITHER_MODES.map((m) => ({ value: m.id, label: m.label, hint: m.hint }))}
        />
      </Field>
      <Field label="Pattern">
        <Select
          className="flex-1"
          value={p.pattern}
          onValueChange={(pattern) => set({ pattern })}
          options={DITHER_PATTERNS.map((d) => ({ value: d.id, label: d.label }))}
        />
      </Field>
      {p.mode === 'palette' && (
        <>
          <Field label="Palette">
            <PaletteSelect value={p.paletteId} onChange={(paletteId) => set({ paletteId })} />
          </Field>
          <Field label="Matching">
            <Segmented className="flex-1" value={p.metric} onChange={(metric) => set({ metric })} options={METRICS} />
          </Field>
          <Field label="">
            <Checkbox
              checked={p.twoNearest}
              onCheckedChange={(twoNearest) => set({ twoNearest })}
              label="Two nearest colors only"
              hint="Mix only the two palette colors closest to each pixel: cleaner, less noisy."
            />
          </Field>
        </>
      )}
      {p.mode === 'levels' && <LevelsSlider value={p.levels} onChange={(levels) => set({ levels })} />}
      <ParamSlider label="Strength" value={p.strength} min={0} max={1} step={0.01} onChange={(strength) => set({ strength })} />
      <ParamSlider label="Pattern scale" hint="Pixels per pattern cell." value={p.scale} min={1} max={8} ticks={8} onChange={(scale) => set({ scale })} suffix="×" />
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

const EDITORS: Record<string, (props: EditorProps<never>) => React.JSX.Element> = {
  adjust: AdjustEditor as never,
  downscale: DownscaleEditor as never,
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
