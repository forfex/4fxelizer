import { THEME_HINTS, THEME_NAMES, THEMES } from '@shared/api'
import { openImage, redo, undo } from '@/actions'
import { useSavedSettings, withShortcut } from '@/settings'
import { useApp } from '@/store'
import { PresetsMenu } from './Presets'
import { Button } from './ui/button'
import { MinusIcon, PlusIcon, RedoIcon, SettingsIcon, UndoIcon } from './ui/icons'
import { Lcd } from './ui/retro'
import { Select } from './ui/select'
import { WorkspaceMenu } from './Workspace'

function Separator() {
  return <div className="mx-1 h-5 w-(--px) shrink-0 bg-edge shadow-[var(--px)_0_0_var(--fx-bevel-light)]" />
}

export function Toolbar() {
  const gpu = useApp((s) => s.gpu)
  const hasImage = useApp((s) => s.image !== null)
  const zoom = useApp((s) => s.view.zoom)
  const grid = useApp((s) => s.grid)
  const split = useApp((s) => s.split)
  const tile = useApp((s) => s.tile)
  const theme = useApp((s) => s.theme)
  const canUndo = useApp((s) => s.past.length > 0)
  const canRedo = useApp((s) => s.future.length > 0)
  const { zoomStep, zoomFit, zoomActual, toggleGrid, toggleSplit, toggleTile, setTheme, setExportOpen, setSettingsOpen } = useApp.getState()
  // Tooltips show the shortcuts as the user set them.
  const settings = useSavedSettings()
  const tip = (text: string, command: Parameters<typeof withShortcut>[1]): string => withShortcut(text, command, settings)

  return (
    <header className="flex h-10 shrink-0 items-center gap-1 overflow-hidden border-b-px border-edge bg-panel px-2 shadow-[inset_0_var(--px)_0_var(--fx-bevel-light)]">
      <Button onClick={openImage} disabled={gpu.status !== 'ready'} title={tip('Open image', 'open')}>
        Open…
      </Button>
      <Button variant="primary" onClick={() => setExportOpen(true)} disabled={!hasImage} title={tip('Export PNG, TGA or BMP', 'export')}>
        Export…
      </Button>
      <PresetsMenu />

      <Separator />
      <Button size="icon" onClick={undo} disabled={!canUndo} title={tip('Undo', 'undo')} aria-label="Undo">
        <UndoIcon />
      </Button>
      <Button size="icon" onClick={redo} disabled={!canRedo} title={tip('Redo', 'redo')} aria-label="Redo">
        <RedoIcon />
      </Button>

      <Separator />
      <Button size="icon" onClick={() => zoomStep(-1)} disabled={!hasImage} title={tip('Zoom out', 'zoom-out')} aria-label="Zoom out">
        <MinusIcon />
      </Button>
      <Lcd className="w-16" title="Zoom (100% = one image pixel per screen pixel)">
        {hasImage ? `${Math.round(zoom * 100)}%` : '—'}
      </Lcd>
      <Button size="icon" onClick={() => zoomStep(1)} disabled={!hasImage} title={tip('Zoom in', 'zoom-in')} aria-label="Zoom in">
        <PlusIcon />
      </Button>
      <Button onClick={zoomFit} disabled={!hasImage} title={tip('Fit to window', 'zoom-fit')}>
        Fit
      </Button>
      <Button onClick={zoomActual} disabled={!hasImage} title={tip('Actual pixels', 'zoom-actual')}>
        1:1
      </Button>

      <Separator />
      <Button aria-pressed={grid} onClick={toggleGrid} title={tip('Pixel grid', 'toggle-grid')}>
        Grid
      </Button>
      <Button aria-pressed={split} onClick={toggleSplit} title={tip('Before/after split', 'toggle-split')}>
        Split
      </Button>
      <Button aria-pressed={tile} onClick={toggleTile} title={tip('Tiling view: copies around the texture to check its seams', 'toggle-tile')}>
        Tile
      </Button>

      <div className="flex-1" />
      <WorkspaceMenu />
      <Select
        className="w-28"
        title="Interface theme"
        value={theme}
        onValueChange={setTheme}
        options={THEMES.map((t) => ({ value: t, label: THEME_NAMES[t], hint: THEME_HINTS[t] }))}
      />
      <Button size="icon" onClick={() => setSettingsOpen(true)} title={tip('Settings', 'settings')} aria-label="Settings">
        <SettingsIcon />
      </Button>
    </header>
  )
}
