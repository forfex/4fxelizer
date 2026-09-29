// The 3D view: the loaded model with the processed texture (or the source, or a map) on it, drawn
// with switchable PSX quirks. Drag to orbit, right/middle/Shift-drag to pan, wheel to zoom,
// double-click to frame the model.

import { useEffect, useRef } from 'react'
import { VIEW3D_RESOLUTIONS, type View3dResolution, type View3dSettings } from '@shared/bake'
import { MAP_CHANNELS, MAP_SLOTS } from '@shared/maps'
import { getEngine } from '@/engine'
import { ModelRenderer } from '@/gpu/model/modelRenderer'
import { cssColor } from '@/lib/pixelSnap'
import { cn } from '@/lib/utils'
import { openModel } from '@/modelActions'
import { useApp, type View3dShow } from '@/store'
import { dolly, frameBounds, orbit, panCamera, type OrbitCamera } from '@/viewer3d/camera'
import { Button } from './ui/button'
import { CaretIcon } from './ui/icons'
import { Menu, MENU_MARK_CLASS, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from './ui/menu'
import { Select } from './ui/select'

/** Accumulated wheel delta per zoom step (see Viewer). */
const WHEEL_STEP = 60

const QUIRKS: { key: keyof Omit<View3dSettings, 'resolution'>; label: string; hint: string }[] = [
  { key: 'snap', label: 'Vertex snapping', hint: 'Vertices snap to whole pixels, so the model wobbles as it moves.' },
  { key: 'affine', label: 'Affine textures', hint: 'Textures map without perspective correction, so they warp across large faces.' },
  { key: 'filter', label: 'Texture filtering', hint: 'Blend between texels (bilinear). Off shows each texel as a hard square, like the PSX.' },
  { key: 'lighting', label: 'Lighting', hint: 'Shade the model with a light from the upper left.' },
  { key: 'dither', label: '15-bit dither', hint: 'Reduce the picture to 15-bit color with the PSX’s 4×4 dither.' }
]

const RESOLUTION_LABELS: Record<View3dResolution, string> = { full: 'Full resolution', '480': '480 lines', '240': '240 lines (PSX)' }

export function View3dPanel() {
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
    let theme = useApp.getState().theme
    let modelVersion = -1

    const frame = (): void => {
      const s = useApp.getState()
      if (s.theme !== theme) {
        theme = s.theme
        background = cssColor('--fx-viewer-bg')
      }
      const gpuModel = engine.model
      const aspect = canvas.width / Math.max(canvas.height, 1)
      if (s.model?.version !== modelVersion) {
        modelVersion = s.model?.version ?? -1
        camera.current = gpuModel ? frameBounds(gpuModel.data.bounds, aspect) : null
      }
      const show = s.view3dShow
      const map = show !== 'result' && show !== 'source' ? s.maps[show] : undefined
      const texture = show === 'result' ? engine.shownTexture : show === 'source' ? engine.sourceTexture : map ? engine.mapTexture(show as keyof typeof s.maps) : null
      const textureView = map ? 1 + MAP_CHANNELS.findIndex((c) => c.id === map.channel) : 0
      renderer.draw({
        model: gpuModel,
        uvSet: s.modelUvSet,
        material: s.modelMaterial,
        texture,
        textureView,
        camera: camera.current ?? { target: [0, 0, 0], yaw: 0, pitch: 0, distance: 1 },
        settings: s.view3d,
        background
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
      camera.current = dolly(c, accumulated < 0 ? 1 : -1, size * 0.01)
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
    <div className="flex h-full min-h-0 flex-col bg-panel p-1.5">
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
    </div>
  )
}

function View3dToolbar({ onFrame }: { onFrame(): void }) {
  const show = useApp((s) => s.view3dShow)
  const maps = useApp((s) => s.maps)
  const view3d = useApp((s) => s.view3d)
  const { setView3d, setView3dShow } = useApp.getState()
  const options: { value: View3dShow; label: string; hint?: string; group?: string }[] = [
    { value: 'result', label: 'Result', hint: 'The texture as the viewer shows it on the right: the result, or the stage you preview.' },
    { value: 'source', label: 'Source', hint: 'The texture as loaded.' },
    ...MAP_SLOTS.filter((m) => maps[m.id]).map((m) => ({ value: m.id as View3dShow, label: m.label, hint: `The ${m.label.toLowerCase()} map.`, group: 'Maps' }))
  ]
  // A map view whose map was removed falls back to the result.
  const value = options.some((o) => o.value === show) ? show : 'result'
  return (
    <div className="absolute top-2 left-2 z-10 flex max-w-[calc(100%-1rem)] flex-wrap gap-1">
      <Select className="w-36" title="What to put on the model" value={value} onValueChange={setView3dShow} options={options} />
      <Menu>
        <MenuTrigger asChild>
          <Button title="PSX look: switch each quirk on or off">
            PSX
            <CaretIcon open className="text-dim" />
          </Button>
        </MenuTrigger>
        <MenuContent className="w-56">
          <MenuLabel>PSX look</MenuLabel>
          {QUIRKS.map((q) => (
            <MenuItem key={q.key} title={q.hint} onSelect={(e) => (e.preventDefault(), setView3d({ [q.key]: !view3d[q.key] }))}>
              {view3d[q.key] && <span className={MENU_MARK_CLASS} />}
              {q.label}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuLabel>Resolution</MenuLabel>
          {VIEW3D_RESOLUTIONS.map((r) => (
            <MenuItem key={r} onSelect={(e) => (e.preventDefault(), setView3d({ resolution: r }))}>
              {view3d.resolution === r && <span className={MENU_MARK_CLASS} />}
              {RESOLUTION_LABELS[r]}
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>
      <Button onClick={onFrame} title="Frame the model (double-click the view)">
        Frame
      </Button>
    </div>
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
