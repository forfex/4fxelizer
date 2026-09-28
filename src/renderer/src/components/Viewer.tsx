import { useEffect, useRef } from 'react'
import { openImage } from '@/actions'
import { getEngine } from '@/engine'
import { cssColor } from '@/lib/pixelSnap'
import { cn } from '@/lib/utils'
import { useApp } from '@/store'
import { pan, pixelAt, stepZoom, zoomAt } from '@/viewer/viewport'
import { Button } from './ui/button'

const isMac = window.fx.platform === 'darwin'
/** Accumulated wheel delta per zoom step (a mouse notch is ~100; touchpads send small deltas). */
const WHEEL_STEP = 60

export function Viewer() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gpuReady = useApp((s) => s.gpu.status === 'ready')
  const hasImage = useApp((s) => s.image !== null)
  const split = useApp((s) => s.split && s.image !== null)
  const splitPos = useApp((s) => s.splitPos)

  // Canvas ↔ engine, sizing and the render loop.
  useEffect(() => {
    const canvas = canvasRef.current
    const engine = getEngine()
    if (!gpuReady || !canvas || !engine) return
    engine.attachCanvas(canvas)

    const colors = {
      background: cssColor('--fx-viewer-bg'),
      checkerA: cssColor('--fx-checker-a'),
      checkerB: cssColor('--fx-checker-b')
    }
    let processed: { stages: unknown; version: number | undefined } | null = null

    // Processing happens inside the frame, so dragging a slider runs the stack at most once per frame.
    const frame = (): void => {
      const s = useApp.getState()
      if (s.image && (processed?.stages !== s.stages || processed.version !== s.image.version)) {
        processed = { stages: s.stages, version: s.image.version }
        try {
          engine.process(s.stages)
        } catch (e) {
          s.setMessage({ kind: 'error', text: `Processing failed: ${(e as Error).message}` })
        }
      }
      engine.draw({
        view: s.view,
        image: s.image,
        splitX: s.split && s.image ? Math.round(s.splitPos * s.canvasSize.width) : null,
        grid: s.grid,
        ...colors
      })
    }

    let raf = 0
    const schedule = (): void => {
      raf ||= requestAnimationFrame(() => {
        raf = 0
        frame()
      })
    }

    const resize = new ResizeObserver(([entry]) => {
      const box = entry!.devicePixelContentBoxSize[0]!
      canvas.width = box.inlineSize
      canvas.height = box.blockSize
      useApp.getState().setCanvasSize({ width: box.inlineSize, height: box.blockSize })
      frame() // resizing clears the canvas; redraw now to avoid a flash
    })
    resize.observe(canvas, { box: 'device-pixel-content-box' })

    const unsubscribe = useApp.subscribe(schedule)
    schedule()
    return () => {
      unsubscribe()
      resize.disconnect()
      cancelAnimationFrame(raf)
      engine.detachCanvas()
    }
  }, [gpuReady])

  // Wheel zoom/pan. Needs a non-passive listener to prevent page scrolling.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let accumulated = 0
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const { view, setView } = useApp.getState()
      const scale = canvas.width / canvas.clientWidth
      // macOS: two-finger scroll pans, pinch (reported as ctrl+wheel) zooms.
      if (isMac && !e.ctrlKey) {
        setView(pan(view, -e.deltaX * scale, -e.deltaY * scale))
        return
      }
      accumulated += e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 33 : e.deltaY
      if (Math.abs(accumulated) < WHEEL_STEP) return
      const dir = accumulated < 0 ? 1 : -1
      accumulated = 0
      const rect = canvas.getBoundingClientRect()
      const anchor = { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale }
      setView(zoomAt(view, stepZoom(view.zoom, dir), anchor))
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  const drag = useRef<{ x: number; y: number } | null>(null)

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (e.button !== 0 && e.button !== 1) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const canvas = e.currentTarget
    const scale = canvas.width / canvas.clientWidth
    const s = useApp.getState()
    if (drag.current) {
      const dx = (e.clientX - drag.current.x) * scale
      const dy = (e.clientY - drag.current.y) * scale
      drag.current = { x: e.clientX, y: e.clientY }
      s.setView(pan(s.view, dx, dy))
    }
    if (s.image) {
      const rect = canvas.getBoundingClientRect()
      const point = { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale }
      s.setCursor(pixelAt(s.view, s.image, point))
    }
  }

  const endDrag = (): void => {
    drag.current = null
  }

  return (
    <div className="bevel-sunken relative min-h-0 min-w-0 flex-1 bg-well p-(--px)">
      <canvas
        ref={canvasRef}
        className="block size-full cursor-grab active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => useApp.getState().setCursor(null)}
        onAuxClick={(e) => e.preventDefault()}
      />
      {split && <SplitHandle pos={splitPos} />}
      {!hasImage && <EmptyState />}
    </div>
  )
}

function SplitHandle({ pos }: { pos: number }) {
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const rect = e.currentTarget.parentElement!.getBoundingClientRect()
    useApp.getState().setSplitPos((e.clientX - rect.left) / rect.width)
  }
  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Before / after divider"
        className="absolute inset-y-0 z-10 flex w-2.5 -translate-x-1/2 cursor-ew-resize justify-center"
        style={{ left: `${pos * 100}%` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
      >
        <div className="h-full w-(--px) bg-accent" />
      </div>
      <ViewerLabel className="left-2">Before</ViewerLabel>
      <ViewerLabel className="right-2">After</ViewerLabel>
    </>
  )
}

function ViewerLabel({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'bevel-raised pointer-events-none absolute top-2 rounded-fx bg-panel/90 px-1.5 py-px',
        'text-small font-semibold tracking-wide text-dim uppercase',
        className
      )}
    >
      {children}
    </span>
  )
}

function EmptyState() {
  const gpu = useApp((s) => s.gpu)
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-dim">
      {gpu.status === 'error' ? (
        <>
          <p className="max-w-md text-center text-text">WebGPU isn't available: {gpu.message}</p>
          <Button onClick={() => useApp.getState().setDiagnosticsOpen(true)}>GPU Diagnostics…</Button>
        </>
      ) : (
        <>
          <p>Drop an image here, or</p>
          <Button variant="primary" onClick={openImage} disabled={gpu.status !== 'ready'}>
            Open Image…
          </Button>
          <p className="text-small">PNG · JPG · WebP · BMP · GIF · TGA</p>
        </>
      )}
    </div>
  )
}
