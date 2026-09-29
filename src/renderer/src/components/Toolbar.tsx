import { THEME_NAMES, THEMES, type Theme } from '@shared/api'
import { openImage, redo, undo } from '@/actions'
import { useApp } from '@/store'
import { PresetsMenu } from './Presets'
import { Button } from './ui/button'
import { MinusIcon, PlusIcon, RedoIcon, UndoIcon } from './ui/icons'
import { Lcd } from './ui/retro'
import { Select } from './ui/select'
import { WorkspaceMenu } from './Workspace'

const mod = window.fx.platform === 'darwin' ? '⌘' : 'Ctrl+'

const THEME_HINTS: Record<Theme, string> = {
  dark: 'Plum with purple and magenta accents',
  night: 'Neutral greyscale, for dim rooms and judging colors',
  light: 'Daylight: pale lilac surfaces, dark text',
  matrix: 'Green phosphor on black',
  retro: 'Classic silver-grey desktop, navy title bars, square corners'
}

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
  const { zoomStep, zoomFit, zoomActual, toggleGrid, toggleSplit, toggleTile, setTheme, setExportOpen } = useApp.getState()
  const redoKey = window.fx.platform === 'darwin' ? '⇧⌘Z' : 'Ctrl+Y'

  return (
    <header className="flex h-10 shrink-0 items-center gap-1 overflow-hidden border-b-px border-edge bg-panel px-2 shadow-[inset_0_var(--px)_0_var(--fx-bevel-light)]">
      <Button onClick={openImage} disabled={gpu.status !== 'ready'} title={`Open image (${mod}O)`}>
        Open…
      </Button>
      <Button variant="primary" onClick={() => setExportOpen(true)} disabled={!hasImage} title={`Export PNG, TGA or BMP (${mod}E)`}>
        Export…
      </Button>
      <PresetsMenu />

      <Separator />
      <Button size="icon" onClick={undo} disabled={!canUndo} title={`Undo (${mod}Z)`} aria-label="Undo">
        <UndoIcon />
      </Button>
      <Button size="icon" onClick={redo} disabled={!canRedo} title={`Redo (${redoKey})`} aria-label="Redo">
        <RedoIcon />
      </Button>

      <Separator />
      <Button size="icon" onClick={() => zoomStep(-1)} disabled={!hasImage} title={`Zoom out (${mod}-)`} aria-label="Zoom out">
        <MinusIcon />
      </Button>
      <Lcd className="w-16" title="Zoom (100% = one image pixel per screen pixel)">
        {hasImage ? `${Math.round(zoom * 100)}%` : '—'}
      </Lcd>
      <Button size="icon" onClick={() => zoomStep(1)} disabled={!hasImage} title={`Zoom in (${mod}=)`} aria-label="Zoom in">
        <PlusIcon />
      </Button>
      <Button onClick={zoomFit} disabled={!hasImage} title={`Fit to window (${mod}0)`}>
        Fit
      </Button>
      <Button onClick={zoomActual} disabled={!hasImage} title={`Actual pixels (${mod}1)`}>
        1:1
      </Button>

      <Separator />
      <Button aria-pressed={grid} onClick={toggleGrid} title={`Pixel grid (${mod}G)`}>
        Grid
      </Button>
      <Button aria-pressed={split} onClick={toggleSplit} title={`Before/after split (${mod}\\)`}>
        Split
      </Button>
      <Button aria-pressed={tile} onClick={toggleTile} title={`Tiling view: copies around the texture to check its seams (${mod}T)`}>
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
    </header>
  )
}
