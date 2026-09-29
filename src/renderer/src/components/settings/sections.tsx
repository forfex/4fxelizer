// The sections of the Settings dialog (except the shortcuts, in Keybinds.tsx). Each is a few
// Field / ParamSlider rows, so they reflow like panel rows do.

import { useEffect, useState } from 'react'
import {
  DEFAULT_SETTINGS,
  LIVE_RELOAD_NAMES,
  THEME_HINTS,
  THEME_NAMES,
  THEMES,
  UI_SCALES,
  VIEW_MODE_NAMES,
  VIEW_MODES,
  WHEEL_DELAY,
  type GpuPreference,
  type LiveReloadMode,
  type MainGpuInfo,
  type WheelMode
} from '@shared/api'
import { listGpus, type GpuEntry } from '@/gpu/gpuList'
import { cn } from '@/lib/utils'
import { saveSettings, useSavedSettings } from '@/settings'
import { useApp } from '@/store'
import { Button } from '../ui/button'
import { Checkbox, Field, ParamSlider, Segmented } from '../ui/controls'
import { MENU_MARK_CLASS } from '../ui/menu'
import { Lcd, Led } from '../ui/retro'
import { Select } from '../ui/select'
import { Slider } from '../ui/slider'

export function InterfaceSection() {
  const { uiScale } = useSavedSettings()
  return (
    <Field label="Scale" hint="Size of the whole interface: text, panels and controls. The image in the viewer keeps its zoom.">
      <Segmented
        value={String(uiScale)}
        onChange={(v) => saveSettings({ uiScale: Number(v) })}
        options={UI_SCALES.map((s) => ({ value: String(s), label: `${Math.round(s * 100)}%` }))}
      />
    </Field>
  )
}

export function ResetSection() {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!confirming) return
    const timer = window.setTimeout(() => setConfirming(false), 4000)
    return () => window.clearTimeout(timer)
  }, [confirming])

  const restore = (): void => {
    const { wheel, keybinds, gpu, uiScale, invertZoom, theme, liveReload } = DEFAULT_SETTINGS
    saveSettings({ wheel, keybinds, gpu, uiScale, invertZoom })
    useApp.getState().setTheme(theme)
    useApp.getState().setLiveReload(liveReload)
    setConfirming(false)
  }

  return (
    <>
      <Field label="Folder" hint="Where settings.json and your presets are kept.">
        <Button onClick={() => window.fx.showUserDataFolder().then(() => setError(''), (e: Error) => setError(e.message))}>Show settings folder</Button>
        {error && <span className="text-led-error">{error}</span>}
      </Field>
      <Field label="Defaults" hint="Theme, scale, mouse, viewer, live reload, shortcut and GPU settings. Panel layouts, workspaces and presets stay as they are.">
        <Button onClick={() => (confirming ? restore() : setConfirming(true))} aria-pressed={confirming}>
          {confirming ? 'Click again to restore' : 'Restore default settings'}
        </Button>
      </Field>
    </>
  )
}

export function AppearanceSection() {
  const theme = useApp((s) => s.theme)
  const setTheme = useApp((s) => s.setTheme)
  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-1 gap-1.5 @min-[520px]/panel:grid-cols-2">
      {THEMES.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={t === theme}
          onClick={() => setTheme(t)}
          className={cn(
            'relative flex flex-col items-start gap-0.5 rounded-fx border-px border-edge bg-panel-hi py-1.5 pr-2 pl-5.5 text-left bevel-raised',
            'hover:bg-hover focus-visible:ring-focus',
            'aria-checked:bg-well aria-checked:bevel-sunken'
          )}
        >
          {t === theme && <span className={MENU_MARK_CLASS} />}
          <span className="font-display font-bold tracking-[0.02em]">{THEME_NAMES[t]}</span>
          <span className="text-small text-dim">{THEME_HINTS[t]}</span>
        </button>
      ))}
    </div>
  )
}

const WHEEL_MODE_OPTIONS: { value: WheelMode; label: string; hint: string }[] = [
  {
    value: 'hover',
    label: 'Rest to arm',
    hint: 'The wheel changes a slider or dropdown once the pointer has rested on it (or it was clicked). Until then it scrolls the panel.'
  },
  { value: 'click', label: 'Click to arm', hint: 'The wheel changes a slider or dropdown only after it was clicked. Until then it scrolls the panel.' },
  { value: 'always', label: 'Always', hint: 'The wheel always changes the slider or dropdown under the pointer.' },
  { value: 'off', label: 'Off', hint: 'The wheel only scrolls panels and never changes values.' }
]

const TRY_OPTIONS = ['Nearest', 'Bilinear', 'Box', 'Lanczos'].map((v) => ({ value: v, label: v }))

export function WheelSection() {
  const { wheel } = useSavedSettings()
  const [trySlider, setTrySlider] = useState(50)
  const [trySelect, setTrySelect] = useState('Nearest')
  const mode = WHEEL_MODE_OPTIONS.find((o) => o.value === wheel.mode)!
  return (
    <>
      <Field label="Wheel">
        <Segmented value={wheel.mode} onChange={(m) => saveSettings({ wheel: { ...wheel, mode: m } })} options={WHEEL_MODE_OPTIONS} />
      </Field>
      <p className="text-dim">{mode.hint}</p>
      <ParamSlider
        label="Rest time"
        hint="How long the pointer rests on a control before the wheel changes it."
        value={wheel.delay}
        onChange={(delay) => saveSettings({ wheel: { ...wheel, delay } })}
        min={WHEEL_DELAY.min}
        max={WHEEL_DELAY.max}
        step={50}
        suffix="ms"
        disabled={wheel.mode !== 'hover'}
      />
      <Field label="Try it" hint="Scroll over these to feel the setting. They change nothing else.">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <Slider className="min-w-24 flex-1" value={[trySlider]} onValueChange={([v]) => setTrySlider(v!)} min={0} max={100} aria-label="Test slider" />
          <Lcd className="w-12">{trySlider}</Lcd>
          <Select className="w-28" value={trySelect} onValueChange={setTrySelect} options={TRY_OPTIONS} />
        </div>
      </Field>
    </>
  )
}

export function ViewerSection() {
  const { invertZoom } = useSavedSettings()
  const grid = useApp((s) => s.grid)
  const split = useApp((s) => s.split)
  const tile = useApp((s) => s.tile)
  const viewMode = useApp((s) => s.viewMode)
  const { toggleGrid, toggleSplit, toggleTile, setViewMode } = useApp.getState()
  return (
    <>
      <Field label="View" hint="The texture, the texture and the model side by side, or the model. Also on the toolbar and in the View menu.">
        <Segmented value={viewMode} onChange={setViewMode} options={VIEW_MODES.map((m) => ({ value: m, label: VIEW_MODE_NAMES[m] }))} />
      </Field>
      <Field label="Wheel zoom">
        <Checkbox
          checked={invertZoom}
          onCheckedChange={(v) => saveSettings({ invertZoom: v })}
          label="Invert (wheel up zooms out)"
          hint="Applies to the 2D viewer and the 3D view."
        />
      </Field>
      <Field label="Show" hint="Also on the toolbar; remembered between sessions.">
        <Checkbox checked={grid} onCheckedChange={toggleGrid} label="Pixel grid" />
        <Checkbox checked={split} onCheckedChange={toggleSplit} label="Before/after split" />
        <Checkbox checked={tile} onCheckedChange={toggleTile} label="Tiling view" />
      </Field>
    </>
  )
}

const LIVE_RELOAD_OPTIONS: { value: LiveReloadMode; label: string; hint: string }[] = [
  {
    value: 'all',
    label: LIVE_RELOAD_NAMES.all,
    hint: 'When an open texture, its maps or the model are saved from another app, load them again, keeping the stack, the zoom and the 3D camera.'
  },
  {
    value: 'per-file',
    label: LIVE_RELOAD_NAMES['per-file'],
    hint: 'Like All Files, but only for the textures and the model whose reload switch is on (in the Textures panel). New ones start switched on.'
  },
  { value: 'off', label: LIVE_RELOAD_NAMES.off, hint: 'Files are never reloaded; open them again to see changes.' }
]

export function FilesSection() {
  const liveReload = useApp((s) => s.liveReload)
  const mode = LIVE_RELOAD_OPTIONS.find((o) => o.value === liveReload)!
  return (
    <>
      <Field label="Live reload" hint="Also in File › Reload Changed Files.">
        <Segmented value={liveReload} onChange={(m) => useApp.getState().setLiveReload(m)} options={LIVE_RELOAD_OPTIONS} />
      </Field>
      <p className="text-dim">{mode.hint}</p>
    </>
  )
}

const GPU_OPTIONS:{ value: GpuPreference; label: string; hint: string }[] = [
  { value: 'auto', label: 'Automatic', hint: 'Let the system choose, asking WebGPU for its fastest adapter.' },
  { value: 'high-performance', label: 'High performance', hint: 'Run on the discrete (faster) GPU.' },
  { value: 'low-power', label: 'Power saving', hint: 'Run on the integrated GPU: slower, easier on a laptop battery.' }
]

export function GpuSection() {
  const { gpu: preference } = useSavedSettings()
  const status = useApp((s) => s.gpu)
  const [info, setInfo] = useState<MainGpuInfo | null>(null)
  useEffect(() => {
    window.fx.getGpuInfo().then(setInfo, () => setInfo(null))
  }, [])
  const gpus: GpuEntry[] = info ? listGpus(info.gpuInfo) : []
  const canChoose = gpus.length > 1 || preference !== 'auto'
  const needsRestart = info !== null && info.gpuPreference !== preference

  return (
    <>
      <Field label="In use">
        <Led state={status.status === 'ready' ? 'on' : status.status === 'error' ? 'error' : 'busy'} />
        <span className="min-w-0">{status.status === 'ready' ? status.adapter : status.status === 'error' ? status.message : 'Starting…'}</span>
      </Field>
      <Field label="Found" hint="Graphics cards the system reports.">
        {!info ? (
          <span className="text-dim">Looking…</span>
        ) : gpus.length === 0 ? (
          <span className="text-dim">No details available</span>
        ) : (
          <ul className="flex min-w-0 flex-col">
            {gpus.map((g, i) => (
              <li key={i}>
                {g.name}
                {g.active && <span className="ml-1.5 text-small text-dim">(active)</span>}
              </li>
            ))}
          </ul>
        )}
      </Field>
      {canChoose ? (
        <Field label="Prefer" hint="Which GPU to run on when the computer has two. Applies after a restart.">
          <Segmented value={preference} onChange={(gpu) => saveSettings({ gpu })} options={GPU_OPTIONS} />
        </Field>
      ) : (
        info && <p className="text-dim">Only one GPU was found, so there is none to choose.</p>
      )}
      {needsRestart && (
        <div className="flex flex-wrap items-center gap-2">
          <Led state="warn" />
          <span className="min-w-0 flex-1">The GPU choice applies after a restart. Restarting closes the open image: export or save a preset first.</span>
          <Button variant="primary" onClick={() => window.fx.relaunch()}>
            Restart now
          </Button>
        </div>
      )}
      <Field label="">
        <Button
          onClick={() => {
            useApp.getState().setSettingsOpen(false)
            useApp.getState().setDiagnosticsOpen(true)
          }}
        >
          GPU Diagnostics…
        </Button>
      </Field>
    </>
  )
}
