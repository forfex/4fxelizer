import { openImage, redo, undo } from '@/actions'
import { useApp } from '@/store'
import { Button } from './ui/button'
import { Led, Lcd } from './ui/retro'

const mod = window.fx.platform === 'darwin' ? '⌘' : 'Ctrl+'

function Separator() {
  return <div className="mx-1 h-5 w-(--px) bg-bevel-dark shadow-[var(--px)_0_0_var(--fx-bevel-light)]" />
}

export function Toolbar() {
  const gpu = useApp((s) => s.gpu)
  const hasImage = useApp((s) => s.image !== null)
  const zoom = useApp((s) => s.view.zoom)
  const grid = useApp((s) => s.grid)
  const split = useApp((s) => s.split)
  const canUndo = useApp((s) => s.past.length > 0)
  const canRedo = useApp((s) => s.future.length > 0)
  const { zoomStep, zoomFit, zoomActual, toggleGrid, toggleSplit, setDiagnosticsOpen, setExportOpen } = useApp.getState()
  const redoKey = window.fx.platform === 'darwin' ? '⇧⌘Z' : 'Ctrl+Y'

  return (
    <header className="bevel-raised flex h-10 shrink-0 items-center gap-1 bg-panel px-2">
      <span className="mr-2 font-mono text-ui font-bold tracking-widest text-accent">4FXELIZER</span>
      <Button onClick={openImage} disabled={gpu.status !== 'ready'} title={`Open image (${mod}O)`}>
        Open…
      </Button>
      <Button onClick={() => setExportOpen(true)} disabled={!hasImage} title={`Export PNG (${mod}E)`}>
        Export…
      </Button>

      <Separator />
      <Button size="icon" onClick={undo} disabled={!canUndo} title={`Undo (${mod}Z)`}>
        ↶
      </Button>
      <Button size="icon" onClick={redo} disabled={!canRedo} title={`Redo (${redoKey})`}>
        ↷
      </Button>

      <Separator />
      <Button size="icon" onClick={() => zoomStep(-1)} disabled={!hasImage} title={`Zoom out (${mod}-)`}>
        −
      </Button>
      <Lcd className="w-16" title="Zoom (100% = one image pixel per screen pixel)">
        {hasImage ? `${Math.round(zoom * 100)}%` : '—'}
      </Lcd>
      <Button size="icon" onClick={() => zoomStep(1)} disabled={!hasImage} title={`Zoom in (${mod}=)`}>
        +
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

      <div className="flex-1" />
      <Button variant="ghost" size="sm" onClick={() => setDiagnosticsOpen(true)} title="GPU diagnostics">
        <Led state={gpu.status === 'ready' ? 'on' : gpu.status === 'error' ? 'error' : 'warn'} />
        <span className="max-w-64 truncate text-small text-dim">
          {gpu.status === 'ready' ? gpu.adapter : gpu.status === 'error' ? 'WebGPU unavailable' : 'Starting GPU…'}
        </span>
      </Button>
    </header>
  )
}
