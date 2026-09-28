import { useEffect, useRef } from 'react'
import { openImage, pickColor } from '@/actions'
import { getEngine } from '@/engine'
import { cssColor } from '@/lib/pixelSnap'
import { stageLabel } from '@/gpu/passes'
import { cn } from '@/lib/utils'
import { useApp } from '@/store'
import { pan, pixelAt, splitPosAt, splitScreenX, stepZoom, zoomAt } from '@/viewer/viewport'
import { Button } from './ui/button'

const isMac = window.fx.platform === 'darwin'
/** Accumulated wheel delta per zoom step (a mouse notch is ~100; touchpads send small deltas). */
const WHEEL_STEP = 60

export function Viewer() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gpuReady = useApp((s) => s.gpu.status === 'ready')
  const hasImage = useApp((s) => s.image !== null)
  const split = useApp((s) => s.split && s.image !== null)
  // Divider x in canvas device pixels; it's anchored to the image, so it follows pans and zooms.
  const splitX = useApp((s) => (s.split && s.image ? splitScreenX(s.view, s.image, s.splitPos) : null))
  const canvasWidth = useApp((s) => s.canvasSize.width)
  const picking = useApp((s) => s.picking && s.image !== null)
  const previewLabel = useApp((s) => {
    const m = s.stages.findIndex((st) => st.uid === s.maskUid)
    if (m >= 0) return `Mask of ${m + 1}. ${stageLabel(s.stages[m]!.passId)}`
    const i = s.stages.findIndex((st) => st.uid === s.previewUid)
    return i < 0 ? null : `After ${i + 1}. ${stageLabel(s.stages[i]!.passId)}`
  })

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
    let processed: unknown[] | null = null

    // Processing happens inside the frame, so dragging a slider runs the stack at most once per frame.
    const frame = (): void => {
      const s = useApp.getState()
      const inputs = [s.image?.version, s.stages, s.palettes, s.outputLock, s.previewUid, s.maskUid]
      if (s.image && (!processed || inputs.some((v, i) => v !== processed![i]))) {
        processed = inputs
        try {
          engine.process({
            stages: s.stages,
            palettes: s.palettes,
            outputLock: s.outputLock,
            previewUid: s.previewUid,
            maskUid: s.maskUid
          })
        } catch (e) {
          s.setMessage({ kind: 'error', text: `Processing failed: ${(e as Error).message}` })
        }
      }
      engine.draw({
        view: s.view,
        image: s.image,
        splitX: s.split && s.image ? splitScreenX(s.view, s.image, s.splitPos) : null,
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

  // Esc disarms the eyedropper.
  useEffect(() => {
    if (!picking) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') useApp.getState().setPicking(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [picking])

  const drag = useRef<{ x: number; y: number } | null>(null)

  /** Eyedropper click: picks the texel shown under the pointer, from whichever side of the split it's on. */
  const pickAt = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const canvas = e.currentTarget
    const s = useApp.getState()
    if (!s.image) return
    const scale = canvas.width / canvas.clientWidth
    const rect = canvas.getBoundingClientRect()
    const point = { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale }
    const pixel = pixelAt(s.view, s.image, point)
    if (!pixel) return
    const splitX = s.split ? splitScreenX(s.view, s.image, s.splitPos) : null
    const side = splitX !== null && Math.floor(point.x) + 0.5 < splitX ? 'before' : 'after'
    const uv = { u: (point.x - s.view.x) / s.view.zoom / s.image.width, v: (point.y - s.view.y) / s.view.zoom / s.image.height }
    // Shift keeps the eyedropper armed for more picks.
    if (!e.shiftKey) s.setPicking(false)
    void pickColor(side, uv)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (e.button !== 0 && e.button !== 1) return
    // Alt+click picks without arming the eyedropper (like paint programs).
    if (e.button === 0 && (useApp.getState().picking || e.altKey)) {
      pickAt(e)
      return
    }
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

  // `isolate`: the split handle and labels (z-10) must stay below dialogs and menus.
  return (
    <div className="bevel-sunken relative isolate min-h-0 min-w-0 flex-1 bg-well p-(--px)">
      <canvas
        ref={canvasRef}
        className={cn('block size-full', picking ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => useApp.getState().setCursor(null)}
        onAuxClick={(e) => e.preventDefault()}
      />
      {split && splitX !== null && (
        <SplitHandle
          x={splitX}
          visible={splitX > 0 && splitX < canvasWidth}
          canvas={canvasRef}
          afterLabel={previewLabel ?? 'After'}
        />
      )}
      {!split && previewLabel && <ViewerLabel className="right-2 text-accent">{previewLabel}</ViewerLabel>}
      {!hasImage && <EmptyState />}
    </div>
  )
}

interface SplitHandleProps {
  /** Divider position in canvas device pixels. */
  x: number
  visible: boolean
  canvas: React.RefObject<HTMLCanvasElement | null>
  afterLabel: string
}

function SplitHandle({ x, visible, canvas, afterLabel }: SplitHandleProps) {
  const el = canvas.current
  const scale = el && el.clientWidth ? el.width / el.clientWidth : window.devicePixelRatio
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const s = useApp.getState()
    if (!e.currentTarget.hasPointerCapture(e.pointerId) || !canvas.current || !s.image) return
    const rect = canvas.current.getBoundingClientRect()
    s.setSplitPos(splitPosAt(s.view, s.image, (e.clientX - rect.left) * scale))
  }
  return (
    <>
      {visible && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Before / after divider"
          className="absolute inset-y-0 z-10 flex w-2.5 -translate-x-1/2 cursor-ew-resize justify-center"
          // The canvas sits inside the well's var(--px) padding.
          style={{ left: `calc(var(--px) + ${(x + 0.5) / scale}px)` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
        >
          <div className="h-full w-(--px) bg-accent" />
        </div>
      )}
      <ViewerLabel className="left-2">Before</ViewerLabel>
      <ViewerLabel className="right-2">{afterLabel}</ViewerLabel>
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
