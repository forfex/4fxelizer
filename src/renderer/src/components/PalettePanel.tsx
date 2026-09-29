import { useEffect, useRef, useState } from 'react'
import { extractPaletteFromOutput, importPalette, savePalette } from '@/actions'
import { stageLabel } from '@/gpu/passes'
import { cssColor } from '@/lib/pixelSnap'
import { cn } from '@/lib/utils'
import { BUILTIN_PALETTES } from '@/palette/builtins'
import { generatePaletteNow } from '@/palette/controller'
import type { PaletteExportFormat } from '@/palette/formats'
import {
  DEFAULT_GENERATOR,
  GENERATE_METHODS,
  MAX_INDEXED,
  MAX_PALETTE,
  normalizeHex,
  snapHexTo15bit,
  sortColors,
  type GeneratorSettings,
  type Palette,
  type PaletteColor
} from '@/palette/palette'
import { useApp } from '@/store'
import { Button } from './ui/button'
import { Checkbox, Field, INPUT_CLASS, ParamSlider, Segmented } from './ui/controls'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger } from './ui/menu'
import { GroupBox, LCD_CLASS, Led, PanelBody } from './ui/retro'
import { Select } from './ui/select'

export function PalettePanel() {
  const palettes = useApp((s) => s.palettes)
  const selectedId = useApp((s) => s.selectedPaletteId)
  const palette = palettes.find((p) => p.id === selectedId) ?? palettes[0]

  return (
    <PanelBody>
      <GroupBox title="Palettes">
        <div className="flex gap-1">
          <Select
            className="flex-1"
            value={palette?.id ?? null}
            placeholder="No palettes"
            onValueChange={(id) => useApp.getState().selectPalette(id)}
            options={palettes.map((p) => ({ value: p.id, label: `${p.name} (${p.colors.length})` }))}
          />
          <PaletteMenu palette={palette} />
        </div>
        {palette && <NameField key={palette.id} palette={palette} />}
      </GroupBox>
      {palette && <PaletteEditor key={palette.id} palette={palette} />}
    </PanelBody>
  )
}

/** Generator settings of the palette shown in the palette panel. */
export function GeneratePanel() {
  const palette = useApp((s) => s.palettes.find((p) => p.id === s.selectedPaletteId) ?? s.palettes[0])
  return <PanelBody>{palette ? <GeneratorBox palette={palette} /> : <p className="text-dim">No palette selected.</p>}</PanelBody>
}

function PaletteMenu({ palette }: { palette: Palette | undefined }) {
  const { addPalette, removePalette } = useApp.getState()
  const exportAs = (format: PaletteExportFormat) => () => palette && savePalette(palette.id, format)
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button size="icon" className="h-6 w-6" title="Palette actions">
          ⋯
        </Button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem onSelect={() => addPalette({ name: 'New palette', colors: [] })}>New empty</MenuItem>
        <MenuItem onSelect={() => addPalette({ name: 'Generated', colors: [], generator: { ...DEFAULT_GENERATOR } })}>
          New generated
        </MenuItem>
        <MenuSub>
          <MenuSubTrigger>New from built-in</MenuSubTrigger>
          <MenuSubContent>
            {BUILTIN_PALETTES.map((b) => (
              <MenuItem key={b.name} onSelect={() => addPalette({ name: b.name, colors: b.colors.map((hex) => ({ hex })) })}>
                {b.name}
                <span className="ml-auto pl-3 font-mono text-small opacity-70">{b.colors.length}</span>
              </MenuItem>
            ))}
          </MenuSubContent>
        </MenuSub>
        <MenuItem onSelect={importPalette}>Import…</MenuItem>
        <MenuSeparator />
        <MenuLabel>This palette</MenuLabel>
        <MenuItem
          disabled={!palette}
          onSelect={() => palette && addPalette(projectCopy(palette))}
        >
          Duplicate{palette?.ownerUid ? ' as project palette' : ''}
        </MenuItem>
        <MenuSub>
          <MenuSubTrigger disabled={!palette?.colors.length}>Export as</MenuSubTrigger>
          <MenuSubContent>
            <MenuItem onSelect={exportAs('gpl')}>GIMP / Aseprite (.gpl)</MenuItem>
            <MenuItem onSelect={exportAs('hex')}>Lospec hex (.hex)</MenuItem>
            <MenuItem onSelect={exportAs('pal')}>JASC (.pal)</MenuItem>
            <MenuItem disabled={(palette?.colors.length ?? 0) > MAX_INDEXED} onSelect={exportAs('act')}>
              Adobe color table (.act){(palette?.colors.length ?? 0) > MAX_INDEXED ? ' · max 256' : ''}
            </MenuItem>
          </MenuSubContent>
        </MenuSub>
        <MenuItem
          disabled={!palette || !!palette.ownerUid}
          title={palette?.ownerUid ? 'Generated for a stage: switch that stage to "Palette" to remove it.' : undefined}
          onSelect={() => palette && removePalette(palette.id)}
        >
          Delete
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}

/** A copy that belongs to the project: detached from any stage and no longer regenerating. */
function projectCopy(palette: Palette): Omit<Palette, 'id'> {
  const { id: _id, ownerUid: _owner, ...rest } = structuredClone(palette)
  return { ...rest, name: `${palette.name} copy`, generator: rest.generator && { ...rest.generator, auto: false } }
}

function NameField({ palette }: { palette: Palette }) {
  const [name, setName] = useState(palette.name)
  useEffect(() => setName(palette.name), [palette.name])
  const commit = (): void => {
    const trimmed = name.trim()
    if (trimmed && trimmed !== palette.name) useApp.getState().updatePalette(palette.id, { name: trimmed })
    else setName(palette.name)
  }
  return (
    <input
      className={cn(INPUT_CLASS, 'mt-1.5')}
      value={name}
      aria-label="Palette name"
      onChange={(e) => setName(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  )
}

function PaletteEditor({ palette }: { palette: Palette }) {
  const selection = useApp((s) => s.selectedColor)
  const selected = selection?.paletteId === palette.id && selection.index < palette.colors.length ? selection.index : null
  const setSelected = (index: number | null): void =>
    useApp.getState().selectColor(index === null ? null : { paletteId: palette.id, index })
  const hasImage = useApp((s) => s.image !== null)
  const picking = useApp((s) => s.picking)
  const current = selected !== null ? palette.colors[selected] : undefined
  const setColors = (colors: PaletteColor[], coalesce?: string): void =>
    useApp.getState().updatePalette(palette.id, { colors }, coalesce ? { coalesce } : undefined)
  const patchColor = (i: number, patch: Partial<PaletteColor>, coalesce?: string): void =>
    setColors(palette.colors.map((c, j) => (j === i ? { ...c, ...patch } : c)), coalesce)

  const addColor = (): void => {
    if (palette.colors.length >= MAX_PALETTE) return
    setColors([...palette.colors, { hex: current?.hex ?? '#808080' }])
    setSelected(palette.colors.length)
  }
  const removeColor = (i: number): void => {
    setColors(palette.colors.filter((_, j) => j !== i))
    setSelected(palette.colors.length > 1 ? Math.min(i, palette.colors.length - 2) : null)
  }

  return (
    <GroupBox title={`Colors · ${palette.colors.length}`}>
      <div className="flex flex-col gap-2">
        {palette.colors.length > 0 ? (
          palette.colors.length <= SWATCH_BUTTONS_MAX ? (
            <div className="bevel-sunken grid grid-cols-8 gap-px bg-well p-px">
              {palette.colors.map((c, i) => (
                <button
                  key={i}
                  type="button"
                  className={cn(
                    'relative aspect-square min-w-0',
                    selected === i && 'z-10 outline-px outline-offset-1 outline-accent'
                  )}
                  style={{ backgroundColor: c.hex }}
                  title={`${i}: ${c.hex}${c.locked ? ' (locked)' : ''}`}
                  onClick={() => setSelected(selected === i ? null : i)}
                >
                  {c.locked && <span className="absolute right-0 bottom-0 size-1.5 bg-bevel-dark shadow-[0_0_0_var(--px)_var(--fx-bevel-light)]" />}
                </button>
              ))}
            </div>
          ) : (
            <SwatchCanvas colors={palette.colors} selected={selected} onSelect={(i) => setSelected(selected === i ? null : i)} />
          )
        ) : (
          <p className="text-dim">
            {palette.generator ? 'Load an image to generate colors.' : 'No colors yet. Add some, import, or extract them.'}
          </p>
        )}

        {current && selected !== null && (
          <ColorEditor
            key={selected}
            color={current}
            index={selected}
            onChange={(patch, coalesce) => patchColor(selected, patch, coalesce)}
            onRemove={() => removeColor(selected)}
          />
        )}

        <div className="flex flex-wrap gap-1">
          <Button size="sm" onClick={addColor} disabled={palette.colors.length >= MAX_PALETTE}>
            + Color
          </Button>
          <Menu>
            <MenuTrigger asChild>
              <Button size="sm" disabled={palette.colors.length < 2}>Sort ▾</Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem onSelect={() => setColors(sortColors(palette.colors, 'lightness'))}>By lightness</MenuItem>
              <MenuItem onSelect={() => setColors(sortColors(palette.colors, 'hue'))}>By hue</MenuItem>
              <MenuItem onSelect={() => setColors(sortColors(palette.colors, 'chroma'))}>By saturation</MenuItem>
              <MenuItem onSelect={() => setColors([...palette.colors].reverse())}>Reverse</MenuItem>
            </MenuContent>
          </Menu>
          <Button
            size="sm"
            disabled={!palette.colors.length}
            title="Snap every color to PSX 15-bit color (5 bits per channel)"
            onClick={() => setColors(palette.colors.map((c) => ({ ...c, hex: snapHexTo15bit(c.hex) })))}
          >
            15-bit
          </Button>
          <Button
            size="sm"
            disabled={!hasImage}
            aria-pressed={picking}
            title={
              'Eyedropper: click the image to pick a color. Replaces the selected color, or adds one. ' +
              'Shift+click keeps picking, Esc stops. Alt+click in the image picks any time.' +
              (palette.generator ? ' Picked colors are locked, so regenerating keeps them.' : '')
            }
            onClick={() => useApp.getState().setPicking(!picking)}
          >
            Pick
          </Button>
          <Button
            size="sm"
            disabled={!hasImage}
            title="Replace the colors with the distinct colors of the current output (up to 256)"
            onClick={() => extractPaletteFromOutput(palette.id)}
          >
            Extract
          </Button>
        </div>
      </div>
    </GroupBox>
  )
}

/** Above this many colors the swatches are drawn on a canvas instead of one button each. */
const SWATCH_BUTTONS_MAX = 256

/** Compact swatch grid for large palettes (thousands of colors). Click selects a color. */
function SwatchCanvas({
  colors,
  selected,
  onSelect
}: {
  colors: PaletteColor[]
  selected: number | null
  onSelect(index: number): void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const theme = useApp((s) => s.theme)
  const cols = colors.length <= 1024 ? 32 : 64
  const rows = Math.ceil(colors.length / cols)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const draw = (): void => {
      const width = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio))
      const cell = width / cols
      canvas.width = width
      canvas.height = Math.max(1, Math.round(cell * rows))
      const ctx = canvas.getContext('2d')!
      colors.forEach((c, i) => {
        const x = Math.round((i % cols) * cell)
        const y = Math.round(Math.floor(i / cols) * cell)
        ctx.fillStyle = c.hex
        ctx.fillRect(x, y, Math.round(((i % cols) + 1) * cell) - x, Math.round((Math.floor(i / cols) + 1) * cell) - y)
      })
      const token = (name: string): string => `rgb(${cssColor(name).slice(0, 3).map((v) => Math.round(v * 255)).join(',')})`
      const mark = (i: number, color: string, inset: number): void => {
        ctx.strokeStyle = color
        ctx.lineWidth = Math.max(1, Math.round(devicePixelRatio))
        ctx.strokeRect((i % cols) * cell + inset, Math.floor(i / cols) * cell + inset, cell - inset * 2, cell - inset * 2)
      }
      const lockColor = token('--fx-edge')
      colors.forEach((c, i) => c.locked && mark(i, lockColor, 1))
      if (selected !== null && selected < colors.length) mark(selected, token('--fx-magenta'), 0.5)
    }
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [colors, selected, cols, rows, theme])

  const indexAt = (e: React.MouseEvent<HTMLCanvasElement>): number => {
    const rect = e.currentTarget.getBoundingClientRect()
    const cell = rect.width / cols
    return Math.floor((e.clientY - rect.top) / cell) * cols + Math.floor((e.clientX - rect.left) / cell)
  }

  return (
    <div className="bevel-sunken bg-well p-px">
      <canvas
        ref={ref}
        className="block w-full cursor-pointer"
        style={{ aspectRatio: `${cols} / ${rows}` }}
        onClick={(e) => {
          const i = indexAt(e)
          if (i < colors.length) onSelect(i)
        }}
        onMouseMove={(e) => {
          const i = indexAt(e)
          e.currentTarget.title = i < colors.length ? `${i}: ${colors[i]!.hex}${colors[i]!.locked ? ' (locked)' : ''}` : ''
        }}
      />
    </div>
  )
}

function ColorEditor({
  color,
  index,
  onChange,
  onRemove
}: {
  color: PaletteColor
  index: number
  onChange(patch: Partial<PaletteColor>, coalesce?: string): void
  onRemove(): void
}) {
  const [text, setText] = useState(color.hex)
  useEffect(() => setText(color.hex), [color.hex])
  const commit = (): void => {
    const hex = normalizeHex(text)
    if (hex && hex !== color.hex) onChange({ hex })
    else setText(color.hex)
  }
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-6 font-mono text-small text-dim">#{index}</span>
      <label className="bevel-sunken relative size-6 shrink-0 cursor-pointer p-px" title="Pick a color">
        <span className="block size-full" style={{ backgroundColor: color.hex }} />
        <input
          type="color"
          className="absolute inset-0 size-full cursor-pointer opacity-0"
          value={color.hex}
          onChange={(e) => onChange({ hex: e.target.value }, `color:${index}`)}
        />
      </label>
      <input
        className={cn(LCD_CLASS, 'w-22 outline-none focus-visible:ring-focus')}
        value={text}
        aria-label="Hex color"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <Checkbox
        checked={!!color.locked}
        onCheckedChange={(locked) => onChange({ locked })}
        label="Lock"
        hint="Locked colors are kept when the palette is regenerated."
      />
      <Button size="icon" className="ml-auto size-6" title="Remove this color" onClick={onRemove}>
        ×
      </Button>
    </div>
  )
}

function GeneratorBox({ palette }: { palette: Palette }) {
  const job = useApp((s) => s.paletteJobs[palette.id])
  const stages = useApp((s) => s.stages)
  const hasImage = useApp((s) => s.image !== null)
  // Textures on the shared stack, when the active one is on it too (the choice only matters there).
  const sharedCount = useApp((s) => (s.activeTextureId && s.docs.separate[s.activeTextureId] ? 0 : s.textures.filter((t) => !s.docs.separate[t.id]).length))
  const gen = palette.generator

  if (!gen) {
    return (
      <GroupBox title="Generate">
        <p className="mb-2 text-small text-dim">Build this palette from the image.</p>
        <Button
          size="sm"
          onClick={() =>
            useApp.getState().updatePalette(palette.id, {
              generator: { ...DEFAULT_GENERATOR, auto: false, count: Math.max(palette.colors.length, 2) }
            })
          }
        >
          Set up generator
        </Button>
      </GroupBox>
    )
  }

  const set = (patch: Partial<GeneratorSettings>): void =>
    useApp.getState().updatePalette(palette.id, { generator: { ...gen, ...patch } }, { coalesce: `gen:${palette.id}:${Object.keys(patch)}` })
  const fromValue = gen.from.kind === 'source' ? 'source' : gen.from.uid
  const lockedCount = palette.colors.filter((c) => c.locked).length
  const ownerIndex = palette.ownerUid ? stages.findIndex((s) => s.uid === palette.ownerUid) : -1

  return (
    <GroupBox title="Generate">
      <div className="flex flex-col gap-1.5">
        {ownerIndex >= 0 ? (
          <p className="text-small text-dim">
            Generated automatically from the input of stage {ownerIndex + 1} ({stageLabel(stages[ownerIndex]!.passId)}).
          </p>
        ) : (
          <Field label="From" hint="Which image the colors come from.">
            <Select
              className="flex-1"
              value={fromValue}
              onValueChange={(v) => set({ from: v === 'source' ? { kind: 'source' } : { kind: 'stage', uid: v } })}
              options={[
                { value: 'source', label: 'Source image' },
                ...stages.map((s, i) => ({ value: s.uid, label: `Input of ${i + 1}. ${stageLabel(s.passId)}` }))
              ]}
            />
          </Field>
        )}
        {sharedCount > 1 && (
          <Field label="Textures" hint="On the shared stack: each texture gets colors from its own pixels, or all textures share one palette generated from all of them.">
            <Segmented
              className="flex-1"
              value={gen.scope === 'all' ? 'all' : 'each'}
              onChange={(v) => {
                const { scope: _scope, ...rest } = gen
                useApp.getState().updatePalette(palette.id, { generator: v === 'all' ? { ...rest, scope: 'all' } : rest })
              }}
              options={[
                { value: 'each', label: 'Each its own', hint: 'Every texture on the shared stack gets colors generated from its own pixels.' },
                { value: 'all', label: 'One for all', hint: 'One set of colors generated from every texture on the shared stack, used by all of them.' }
              ]}
            />
          </Field>
        )}
        <Field label="Method" hint={GENERATE_METHODS.find((m) => m.id === gen.method)?.hint}>
          <Select
            className="flex-1"
            value={gen.method}
            onValueChange={(method) => set({ method })}
            options={GENERATE_METHODS.map((m) => ({ value: m.id, label: m.label, hint: m.hint }))}
          />
        </Field>
        <ParamSlider label="Colors" scale="log" value={gen.count} min={2} max={MAX_PALETTE} onChange={(count) => set({ count })} />
        {gen.method === 'kmeans' && (
          <ParamSlider label="Quality" hint="K-means iterations." value={gen.quality} min={1} max={32} onChange={(quality) => set({ quality })} />
        )}
        <ParamSlider label="Light weight" hint="Above 1 keeps more light/dark steps." value={gen.lumaWeight} min={0.25} max={3} step={0.05} onChange={(lumaWeight) => set({ lumaWeight })} />
        <ParamSlider label="Hue weight" hint="Above 1 keeps more distinct hues." value={gen.chromaWeight} min={0.25} max={3} step={0.05} onChange={(chromaWeight) => set({ chromaWeight })} />
        <ParamSlider
          label="Gamma"
          hint="Above 1 spends more colors on the darks, below 1 on the lights."
          value={gen.gamma ?? 1}
          min={0.25}
          max={4}
          step={0.05}
          onChange={(gamma) => set({ gamma: gamma === 1 ? undefined : gamma })}
        />
        <Field label="">
          <Checkbox
            checked={!!gen.color15}
            onCheckedChange={(on) => set({ color15: on || undefined })}
            label="15-bit colors (PSX)"
            hint="Snap generated colors to 5 bits per channel, the PSX color depth. Colors that snap together merge, so you may get fewer."
          />
        </Field>
        {lockedCount > 0 && (
          <p className="text-small text-dim">
            {lockedCount} locked color{lockedCount > 1 ? 's' : ''} kept; {Math.max(gen.count - lockedCount, 0)} generated.
          </p>
        )}
        <div className="flex items-center gap-2">
          {!palette.ownerUid && (
            <Checkbox checked={gen.auto} onCheckedChange={(auto) => set({ auto })} label="Auto" hint="Regenerate whenever the image or these settings change." />
          )}
          <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
            {job && (
              <span className="flex min-w-0 items-center gap-1 text-small" title={'message' in job ? job.message : undefined}>
                <Led state={job.status === 'running' ? 'warn' : 'error'} />
                <span className="truncate text-dim">{job.status === 'running' ? 'Working…' : job.message}</span>
              </span>
            )}
            <Button size="sm" disabled={!hasImage || job?.status === 'running'} onClick={() => generatePaletteNow(palette.id)}>
              Generate
            </Button>
          </div>
        </div>
      </div>
    </GroupBox>
  )
}
