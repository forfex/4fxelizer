// The 3D view (in the main view's 3D and 2D / 3D modes): the loaded model with the processed
// texture (or the source, or a map) on it, drawn in a look (Lit, Wireframe, PSX, …) or the user's
// Custom style. Drag to orbit, right/middle/Shift-drag to pan, wheel to zoom, double-click to
// frame the model.

import { useEffect, useRef, useState } from 'react'
import { MAP_CHANNELS, MAP_SLOTS, type MapSlot } from '@shared/maps'
import { view3dStyle } from '@shared/view3d'
import { getEngine } from '@/engine'
import { ModelRenderer, type FrameMap } from '@/gpu/model/modelRenderer'
import { cssColor } from '@/lib/pixelSnap'
import { cn } from '@/lib/utils'
import { openModel } from '@/modelActions'
import { savedSettings } from '@/settings'
import { useApp, type View3dShow } from '@/store'
import { dolly, frameBounds, orbit, panCamera, type OrbitCamera } from '@/viewer3d/camera'
import { Button } from './ui/button'
import { Select } from './ui/select'
import { LookSelect, View3dStylePanel } from './View3dStyle'

/** Accumulated wheel delta per zoom step (see Viewer). */
const WHEEL_STEP = 60

/** The 3D view's well (canvas, toolbar, model readout); the main view places it (see MainView). */
export function View3d() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const camera = useRef<OrbitCamera | null>(null)
  const redraw = useRef<() => void>(() => {})
  const gpuReady = useApp((s) => s.gpu.status === 'ready')
  const model = useApp((s) => s.model)

  useEffect(() => {
    const canvas = canvasRef.current
    const engine = getEngine()
    if (!gpuReady || !canvas || !engine) return
    const renderer = new ModelRenderer(engine.gpu.device, canvas)
    let background = cssColor('--fx-viewer-bg')
    let wireColor = cssColor('--fx-accent')
    let theme = useApp.getState().theme
    let modelVersion = -1
    // The model the camera was framed for: a reload of the same file keeps the camera.
    let framed: string | null = null

    const frame = (): void => {
      const s = useApp.getState()
      if (s.theme !== theme) {
        theme = s.theme
        background = cssColor('--fx-viewer-bg')
        wireColor = cssColor('--fx-accent')
      }
      const gpuModel = engine.model
      const aspect = canvas.width / Math.max(canvas.height, 1)
      if (s.model?.version !== modelVersion) {
        modelVersion = s.model?.version ?? -1
        const identity = s.model ? (s.model.path ?? s.model.name) : null
        if (identity !== framed || !camera.current) {
          framed = identity
          camera.current = gpuModel ? frameBounds(gpuModel.data.bounds, aspect) : null
        }
      }
      const show = s.view3dShow
      const map = show !== 'result' && show !== 'source' ? s.maps[show] : undefined
      const texture = show === 'result' ? engine.shownTexture : show === 'source' ? engine.sourceTexture : map ? engine.mapTexture(show as keyof typeof s.maps) : null
      const textureView = map ? 1 + MAP_CHANNELS.findIndex((c) => c.id === map.channel) : 0
      const frameMap = (slot: MapSlot): FrameMap | undefined => {
        const info = s.maps[slot]
        const t = info ? engine.mapTexture(slot) : null
        return info && t ? { texture: t, channel: MAP_CHANNELS.findIndex((c) => c.id === info.channel) } : undefined
      }
      renderer.draw({
        model: gpuModel,
        uvSet: s.modelUvSet,
        material: s.modelMaterial,
        texture,
        textureView,
        maps: { ao: frameMap('ao'), roughness: frameMap('roughness'), metallic: frameMap('metallic') },
        camera: camera.current ?? { target: [0, 0, 0], yaw: 0, pitch: 0, distance: 1 },
        style: view3dStyle(s.view3d),
        background,
        wireColor,
        pixelRatio: window.devicePixelRatio || 1
      })
    }

    let raf = 0
    const schedule = (): void => {
      raf ||= requestAnimationFrame(() => {
        raf = 0
        frame()
      })
    }
    redraw.current = schedule

    const resize = new ResizeObserver(([entry]) => {
      const box = entry!.devicePixelContentBoxSize[0]!
      if (!box.inlineSize || !box.blockSize) return
      canvas.width = box.inlineSize
      canvas.height = box.blockSize
      frame()
    })
    resize.observe(canvas, { box: 'device-pixel-content-box' })
    const unsubscribe = useApp.subscribe((s, prev) => {
      if (
        s.model !== prev.model ||
        s.modelMaterial !== prev.modelMaterial ||
        s.modelUvSet !== prev.modelUvSet ||
        s.view3d !== prev.view3d ||
        s.view3dShow !== prev.view3dShow ||
        s.maps !== prev.maps ||
        s.image !== prev.image ||
        s.theme !== prev.theme
      ) {
        schedule()
      }
    })
    // The result changes whenever the stack runs.
    const offPlan = engine.onPlan(schedule)
    schedule()
    return () => {
      unsubscribe()
      offPlan()
      resize.disconnect()
      cancelAnimationFrame(raf)
      redraw.current = () => {}
      renderer.dispose()
    }
  }, [gpuReady])

  // Wheel zoom (non-passive, so the panel doesn't scroll).
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let accumulated = 0
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const c = camera.current
      const data = getEngine()?.model?.data
      if (!c || !data) return
      accumulated += e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 33 : e.deltaY
      if (Math.abs(accumulated) < WHEEL_STEP) return
      const { min, max } = data.bounds
      const size = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2])
      camera.current = dolly(c, (accumulated < 0 ? 1 : -1) * (savedSettings().invertZoom ? -1 : 1), size * 0.01)
      accumulated = 0
      redraw.current()
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  const drag = useRef<{ x: number; y: number; pan: boolean } | null>(null)

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (e.button > 2) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, pan: e.button !== 0 || e.shiftKey }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const d = drag.current
    const c = camera.current
    if (!d || !c) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    drag.current = { ...d, x: e.clientX, y: e.clientY }
    camera.current = d.pan ? panCamera(c, dx, dy, e.currentTarget.clientHeight) : orbit(c, dx, dy)
    redraw.current()
  }
  const endDrag = (): void => {
    drag.current = null
  }
  const frameModel = (): void => {
    const data = getEngine()?.model?.data
    const canvas = canvasRef.current
    if (!data || !canvas) return
    camera.current = frameBounds(data.bounds, canvas.width / Math.max(canvas.height, 1))
    redraw.current()
  }

  return (
    <div className="bevel-sunken relative isolate min-h-0 min-w-0 flex-1 bg-well p-(--px)">
      <canvas
        ref={canvasRef}
        className={cn('block size-full', model && 'cursor-grab active:cursor-grabbing')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={frameModel}
        onContextMenu={(e) => e.preventDefault()}
        onAuxClick={(e) => e.preventDefault()}
      />
      {model ? (
        <>
          <View3dToolbar onFrame={frameModel} />
          <span className="bevel-raised pointer-events-none absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate rounded-fx bg-panel/90 px-1.5 py-px text-small text-dim">
            {model.name} · {model.triangles.toLocaleString('en-US')} tris
          </span>
        </>
      ) : (
        <EmptyState />
      )}
    </div>
  )
}

function View3dToolbar({ onFrame }: { onFrame(): void }) {
  const show = useApp((s) => s.view3dShow)
  const maps = useApp((s) => s.maps)
  const setView3dShow = useApp((s) => s.setView3dShow)
  const [styleOpen, setStyleOpen] = useState(false)
  const options: { value: View3dShow; label: string; hint?: string; group?: string }[] = [
    { value: 'result', label: 'Result', hint: 'The texture as the viewer shows it on the right: the result, or the stage you preview.' },
    { value: 'source', label: 'Source', hint: 'The texture as loaded.' },
    ...MAP_SLOTS.filter((m) => maps[m.id]).map((m) => ({ value: m.id as View3dShow, label: m.label, hint: `The ${m.label.toLowerCase()} map.`, group: 'Maps' }))
  ]
  // A map view whose map was removed falls back to the result.
  const value = options.some((o) => o.value === show) ? show : 'result'
  return (
    <>
      <div className="absolute top-2 left-2 z-10 flex max-w-[calc(100%-1rem)] flex-wrap gap-1">
        <Select className="w-36" title="What to put on the model" value={value} onValueChange={setView3dShow} options={options} />
        <LookSelect />
        <Button aria-pressed={styleOpen} className={cn(styleOpen && 'bg-well bevel-sunken')} onClick={() => setStyleOpen(!styleOpen)} title="Every setting of the look">
          Style…
        </Button>
        <Button onClick={onFrame} title="Frame the model (double-click the view)">
          Frame
        </Button>
      </div>
      {styleOpen && <View3dStylePanel className="absolute top-11 right-2 z-20 max-h-[calc(100%-3.5rem)]" onClose={() => setStyleOpen(false)} />}
    </>
  )
}

function EmptyState() {
  const gpuReady = useApp((s) => s.gpu.status === 'ready')
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-dim">
      <p>Drop a model here, or</p>
      <Button variant="primary" onClick={openModel} disabled={!gpuReady}>
        Open Model…
      </Button>
      <p className="text-small">glTF · GLB · FBX · OBJ</p>
    </div>
  )
}
