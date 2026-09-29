// The 3D view's look picker and style panel: every setting of the shown style. Editing a built-in
// look turns it into the Custom style (the look stays as it was).

import { LOOK_CHOICES } from '@shared/api'
import { VIEW3D_LOOK_INFO, view3dStyle, type View3dLookChoice, type View3dStyle } from '@shared/view3d'
import { cn } from '@/lib/utils'
import { useApp } from '@/store'
import { Checkbox, Field, ParamSlider, Segmented } from './ui/controls'
import { CloseIcon, DitherRamp } from './ui/retro'
import { Select } from './ui/select'

const LOOK_OPTIONS = LOOK_CHOICES.map((l) =>
  l === 'custom'
    ? { value: l, label: 'Custom', hint: 'Your own style: edit any setting of a look to make it.', group: 'Yours' }
    : { value: l, label: VIEW3D_LOOK_INFO[l].label, hint: VIEW3D_LOOK_INFO[l].hint, group: l === 'psx' || l === 'n64' ? 'Consoles' : undefined }
)

export function LookSelect() {
  const look = useApp((s) => s.view3d.look)
  return (
    <Select<View3dLookChoice>
      className="w-40"
      title="How the model is drawn (View › 3D Look)"
      value={look}
      onValueChange={(l) => useApp.getState().setView3d({ look: l })}
      options={LOOK_OPTIONS}
    />
  )
}

type Choices<K extends keyof View3dStyle> = readonly { value: View3dStyle[K] & string; label: string; hint?: string }[]

const SHADINGS: Choices<'shading'> = [
  { value: 'unlit', label: 'Off', hint: 'The texture’s exact colors.' },
  { value: 'vertex', label: 'Vertex', hint: 'Gouraud: light worked out per vertex, like the PSX and N64.' },
  { value: 'pixel', label: 'Pixel', hint: 'Per-pixel lights with highlights, shadows and the AO / roughness / metallic maps.' }
]
const SURFACES: Choices<'surface'> = [
  { value: 'texture', label: 'Texture', hint: 'The texture chosen on the left of the toolbar.' },
  { value: 'clay', label: 'Clay', hint: 'Plain gray: the shape alone.' },
  { value: 'normals', label: 'Normals', hint: 'Surface directions as colors.' }
]
const WIREFRAMES: Choices<'wireframe'> = [
  { value: 'off', label: 'Off' },
  { value: 'overlay', label: 'Overlay', hint: 'Triangle edges over the surface.' },
  { value: 'only', label: 'Only', hint: 'Triangle edges alone, hidden lines removed.' }
]
const RESOLUTIONS: Choices<'resolution'> = [
  { value: 'full', label: 'Full', hint: 'The window’s own resolution.' },
  { value: '480', label: '480', hint: '480 lines, scaled up.' },
  { value: '240', label: '240', hint: '240 lines, scaled up, like the PSX and N64.' }
]
const UPSCALES: Choices<'upscale'> = [
  { value: 'sharp', label: 'Sharp', hint: 'Square pixels.' },
  { value: 'smooth', label: 'Smooth', hint: 'Soft, like a console on a TV.' }
]
const FILTERS: Choices<'filter'> = [
  { value: 'nearest', label: 'Nearest', hint: 'Each texel a hard square, like the PSX.' },
  { value: 'bilinear', label: 'Bilinear', hint: 'Blend between four texels.' },
  { value: 'three-point', label: '3-point', hint: 'The N64’s filter: blend between three texels.' }
]
const COLOR_DEPTHS: Choices<'colorDepth'> = [
  { value: 'full', label: 'Full', hint: '8 bits per channel.' },
  { value: 'rgb555', label: '15-bit', hint: '5 bits per channel, like the PSX and N64 framebuffers.' }
]
const DITHERS: Choices<'dither'> = [
  { value: 'none', label: 'None' },
  { value: 'psx', label: 'PSX', hint: 'The PSX’s 4×4 ordered dither.' },
  { value: 'n64', label: 'N64', hint: 'The N64’s magic-square dither.' }
]

const SWITCHES: { key: 'snap' | 'affine' | 'antialias' | 'backfaces' | 'shadows' | 'maps'; label: string; hint: string; pixelOnly?: boolean }[] = [
  { key: 'snap', label: 'Vertex snapping', hint: 'Vertices snap to whole pixels, so the model wobbles as it moves (PSX).' },
  { key: 'affine', label: 'Affine textures', hint: 'Textures map without perspective correction, so they warp across large faces (PSX).' },
  { key: 'antialias', label: 'Antialiasing', hint: 'Smooth triangle edges (4× multisampling).' },
  { key: 'backfaces', label: 'Back faces', hint: 'Draw the back of faces. Off shows faces pointing away (flipped normals) as holes.' },
  { key: 'shadows', label: 'Shadows', hint: 'The key light casts shadows.', pixelOnly: true },
  { key: 'maps', label: 'Use maps', hint: 'Read the AO, roughness and metallic maps (imported or baked).', pixelOnly: true }
]

/** Floating panel with every setting of the shown style. */
export function View3dStylePanel({ onClose, className }: { onClose(): void; className?: string }) {
  const view3d = useApp((s) => s.view3d)
  const edit = useApp.getState().editView3dStyle
  const style = view3dStyle(view3d)
  const pixel = style.shading === 'pixel'
  const wireOnly = style.wireframe === 'only'
  const title = view3d.look === 'custom' ? 'Custom' : VIEW3D_LOOK_INFO[view3d.look].label
  const choice = <K extends keyof View3dStyle>(key: K, label: string, options: Choices<K>, disabled?: boolean, hint?: string) => (
    <Field label={label} hint={hint}>
      <Segmented<View3dStyle[K] & string>
        className="flex-1"
        value={style[key] as View3dStyle[K] & string}
        onChange={(v) => edit({ [key]: v })}
        options={options}
        disabled={disabled}
      />
    </Field>
  )

  return (
    <div
      className={cn('@container/panel flex w-72 flex-col overflow-hidden rounded-fx-lg bg-panel window-frame', className)}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="flex h-7 shrink-0 items-center gap-2 border-b-2 border-edge bg-panel-hi pr-1 pl-2.5 shadow-[inset_var(--px)_var(--px)_0_var(--fx-bevel-light)]">
        <span className="font-display text-[13px] leading-[18px] font-bold tracking-[0.02em] whitespace-nowrap">Style · {title}</span>
        <DitherRamp className="h-2 flex-1" />
        <button
          type="button"
          aria-label="Close"
          title="Close"
          onClick={onClose}
          className="bevel-raised flex size-5 items-center justify-center rounded-fx border-px border-edge bg-panel-hi text-text hover:bg-hover active:bg-well active:bevel-sunken"
        >
          <CloseIcon />
        </button>
      </div>
      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto p-2.5">
        {view3d.look !== 'custom' && <p className="text-small text-dim">Changing a setting makes this look your Custom style.</p>}
        {choice('surface', 'Surface', SURFACES, wireOnly)}
        {choice('shading', 'Lighting', SHADINGS, wireOnly || style.surface === 'normals')}
        {choice('wireframe', 'Wireframe', WIREFRAMES)}
        {choice('filter', 'Filter', FILTERS, wireOnly || style.surface !== 'texture', 'How texels are read.')}
        {choice('resolution', 'Resolution', RESOLUTIONS, false, 'Lines the view is drawn at.')}
        {choice('upscale', 'Upscale', UPSCALES, style.resolution === 'full', 'How a low resolution scales up to the view.')}
        {choice('colorDepth', 'Color', COLOR_DEPTHS, wireOnly)}
        {choice('dither', 'Dither', DITHERS, wireOnly || style.colorDepth === 'full', 'Ordered dither before cutting to 15-bit color.')}
        <ParamSlider
          label="Ambient"
          hint="Light that reaches everywhere (Vertex and Pixel lighting)."
          value={style.ambient}
          onChange={(v) => edit({ ambient: v })}
          min={0}
          max={1}
          step={0.01}
          disabled={wireOnly || style.shading === 'unlit'}
        />
        <ParamSlider
          label="Specular"
          hint="Highlights and reflections (Pixel lighting)."
          value={style.specular}
          onChange={(v) => edit({ specular: v })}
          min={0}
          max={1}
          step={0.01}
          disabled={wireOnly || !pixel}
        />
        <ParamSlider
          label="Fog"
          hint="Far parts fade into the background, like console-era draw distance."
          value={style.fog}
          onChange={(v) => edit({ fog: v })}
          min={0}
          max={1}
          step={0.01}
          disabled={wireOnly}
        />
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 pt-1">
          {SWITCHES.map((sw) => (
            <Checkbox
              key={sw.key}
              label={sw.label}
              hint={sw.hint}
              checked={style[sw.key]}
              disabled={sw.pixelOnly && (!pixel || wireOnly)}
              onCheckedChange={(v) => edit({ [sw.key]: v })}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
