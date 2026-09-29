// The 3D view (in the main view's 3D and 2D / 3D modes): the loaded model with the processed
// texture (or the source, or a map) on it, drawn in a look (Lit, Wireframe, PSX, …) or the user's
// Custom style. With a texture but no model it shows a built-in shape (cube, plane, sphere, torus).
// Drag to orbit, right/middle/Shift-drag to pan, wheel to zoom, Alt-drag to turn the sun,
// double-click to frame the model.

import { useEffect, useRef, useState } from 'react'
import { MAP_CHANNELS, MAP_SLOTS, type MapSlot } from '@shared/maps'
import { VIEW3D_SHAPE_NAMES, VIEW3D_SHAPES, view3dStyle, type View3dShape } from '@shared/view3d'
import { getEngine } from '@/engine'
import { ModelGpu } from '@/gpu/model/modelGpu'
import { ModelRenderer, type FrameMap, type PartTexture } from '@/gpu/model/modelRenderer'
import type { ModelData } from '@/model/model'
import { shapeModel } from '@/model/shapes'
import { partTextures } from '@/stack/textures'
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
/** Sun rotation per CSS pixel of Alt-drag, radians. */
const SUN_SPEED = 0.01

const NAVIGATION: [keys: string, action: string][] = [
  ['Drag', 'orbit'],
  ['Right / Shift-drag', 'pan'],
  ['Wheel', 'zoom'],
  ['Alt-drag', 'turn the sun'],
  ['Double-click', 'frame']
]

/** The 3D view's well (canvas, toolbar, model readout); the main view places it (see MainView). */
export function View3d() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const camera = useRef<OrbitCamera | null>(null)
  const redraw = useRef<() => void>(() => {})
  /** The model or shape drawn last (wheel zoom and framing measure it). */
  const shown = useRef<ModelData | null>(null)
  const lightYaw = useRef(0)
  const gpuReady = useApp((s) => s.gpu.status === 'ready')
  const model = useApp((s) => s.model)
  const hasImage = useApp((s) => !!s.image)

  useEffect(() => {
    const canvas = canvasRef.current
    const engine = getEngine()
    if (!gpuReady || !canvas || !engine) return
    const renderer = new ModelRenderer(engine.gpu.device, canvas)
    let background = cssColor('--fx-viewer-bg')
    let wireColor = cssColor('--fx-accent')
    let theme = useApp.getState().theme
    // The model (or shape) the camera was framed for: a reload of the same file keeps the camera.
    let framed: string | null = null
    let shape: { name: View3dShape; gpu: ModelGpu } | null = null
    const shapeGpu = (name: View3dShape): ModelGpu => {
      if (shape?.name !== name) {
        shape?.gpu.dispose()
        shape = { name, gpu: new ModelGpu(engine.gpu.device, shapeModel(name), null) }
      }
      return shape.gpu
    }

    const frame = (): void => {
      const s = useApp.getState()
      if (s.theme !== theme) {
        theme = s.theme
        background = cssColor('--fx-viewer-bg')
        wireColor = cssColor('--fx-accent')
      }
      const isShape = !s.model && !!s.image
      const gpuModel = s.model ? engine.model : isShape ? shapeGpu(s.view3d.shape) : null
      shown.current = gpuModel?.data ?? null
      const aspect = canvas.width / Math.max(canvas.height, 1)
      const identity = s.model ? `model:${s.model.path ?? s.model.name}` : isShape ? `shape:${s.view3d.shape}` : null
      if (identity !== framed || !camera.current) {
        framed = identity
        camera.current = gpuModel ? frameBounds(gpuModel.data.bounds, aspect) : null
      }
      // A map view whose map the texture doesn't have (any more) shows the result, like the toolbar.
      const show = s.view3dShow !== 'result' && s.view3dShow !== 'source' && !s.maps[s.view3dShow as MapSlot] ? 'result' : s.view3dShow
      const channelIndex = (channel: string): number => MAP_CHANNELS.findIndex((c) => c.id === channel)
      // What a texture puts on the materials drawn with it: its result (the active one as the
      // viewer shows it), its source or one of its maps, plus its maps for the lit style.
      const partOf = (id: string | null): PartTexture | null => {
        const entry = id ? s.textures.find((t) => t.id === id) : undefined
        if (!entry) return null
        const map = show !== 'result' && show !== 'source' ? entry.maps[show] : undefined
        const texture =
          show === 'result'
            ? entry.id === s.activeTextureId
              ? engine.shownTexture
              : engine.outputOf(entry.id)
            : show === 'source'
              ? engine.sourceOf(entry.id)
              : map
                ? engine.mapTexture(show as MapSlot, entry.id)
                : null
        if (!texture) return null
        const frameMap = (slot: MapSlot): FrameMap | undefined => {
          const info = entry.maps[slot]
          const t = info ? engine.mapTexture(slot, entry.id) : null
          return info && t ? { texture: t, channel: channelIndex(info.channel) } : undefined
        }
        return {
          texture,
          view: map ? 1 + channelIndex(map.channel) : 0,
          maps: { ao: frameMap('ao'), roughness: frameMap('roughness'), metallic: frameMap('metallic') }
        }
      }
      const ids = isShape ? [s.activeTextureId] : partTextures(gpuModel?.data.materials.length ?? 0, s.textures, s.activeTextureId, s.modelMaterial)
      const byTexture = new Map<string | null, PartTexture | null>()
      const parts = ids.map((id) => {
        if (!byTexture.has(id)) byTexture.set(id, partOf(id))
        return byTexture.get(id)!
      })
      renderer.draw({
        model: gpuModel,
        uvSet: isShape ? 0 : s.modelUvSet,
        parts,
        camera: camera.current ?? { target: [0, 0, 0], yaw: 0, pitch: 0, distance: 1 },
        style: view3dStyle(s.view3d),
        background,
        wireColor,
        pixelRatio: window.devicePixelRatio || 1,
        lightYaw: lightYaw.current
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
        s.textures !== prev.textures ||
        s.activeTextureId !== prev.activeTextureId ||
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
      shape?.gpu.dispose()
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
      const data = shown.current
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

  const drag = useRef<{ x: number; y: number; mode: 'orbit' | 'pan' | 'sun' } | null>(null)
  const [turningSun, setTurningSun] = useState(false)

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (e.button > 2) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const mode = e.button === 0 && e.altKey ? 'sun' : e.button !== 0 || e.shiftKey ? 'pan' : 'orbit'
    if (mode === 'sun') {
      e.preventDefault()
      setTurningSun(true)
    }
    drag.current = { x: e.clientX, y: e.clientY, mode }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const d = drag.current
    const c = camera.current
    if (!d || !c) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    drag.current = { ...d, x: e.clientX, y: e.clientY }
    // The sun turns only around the vertical axis: horizontal movement.
    if (d.mode === 'sun') lightYaw.current += dx * SUN_SPEED
    else camera.current = d.mode === 'pan' ? panCamera(c, dx, dy, e.currentTarget.clientHeight) : orbit(c, dx, dy)
    redraw.current()
  }
  const endDrag = (): void => {
    drag.current = null
    setTurningSun(false)
  }
  const frameModel = (): void => {
    const data = shown.current
    const canvas = canvasRef.current
    if (!data || !canvas) return
    camera.current = frameBounds(data.bounds, canvas.width / Math.max(canvas.height, 1))
    redraw.current()
  }

  return (
    <div className="bevel-sunken relative isolate min-h-0 min-w-0 flex-1 bg-well p-(--px)">
      <canvas
        ref={canvasRef}
        className={cn('block size-full', (model || hasImage) && (turningSun ? 'cursor-ew-resize' : 'cursor-grab active:cursor-grabbing'))}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={frameModel}
        onContextMenu={(e) => e.preventDefault()}
        onAuxClick={(e) => e.preventDefault()}
      />
      {model || hasImage ? (
        <>
          <View3dToolbar onFrame={frameModel} />
          <div className="pointer-events-none absolute right-2 bottom-2 left-2 flex flex-wrap items-end justify-between gap-1">
            <span className={cn(BADGE_CLASS, 'max-w-full truncate')}>
              {model ? `${model.name} · ${model.triangles.toLocaleString('en-US')} tris` : 'No model open: a preview shape'}
            </span>
            <NavigationHints />
          </div>
        </>
      ) : (
        <EmptyState />
      )}
    </div>
  )
}

const BADGE_CLASS = 'bevel-raised rounded-fx bg-panel/90 px-1.5 py-px text-small text-dim'

/** The view's mouse controls, at the bottom right. */
function NavigationHints() {
  return (
    <span className={cn(BADGE_CLASS, 'ml-auto flex flex-wrap justify-end gap-x-2.5')}>
      {NAVIGATION.map(([keys, action]) => (
        <span key={keys} className="whitespace-nowrap">
          <span className="text-text">{keys}</span> {action}
        </span>
      ))}
    </span>
  )
}

const SHAPE_OPTIONS = VIEW3D_SHAPES.map((shape) => ({ value: shape, label: VIEW3D_SHAPE_NAMES[shape] }))

function View3dToolbar({ onFrame }: { onFrame(): void }) {
  const hasModel = useApp((s) => !!s.model)
  const shape = useApp((s) => s.view3d.shape)
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
        {!hasModel && (
          <Select<View3dShape>
            className="w-40"
            title="Shape to show the texture on (open a model to see yours)"
            value={shape}
            onValueChange={(v) => useApp.getState().setView3d({ shape: v })}
            options={SHAPE_OPTIONS}
          />
        )}
        <Button aria-pressed={styleOpen} className={cn(styleOpen && 'bg-well bevel-sunken')} onClick={() => setStyleOpen(!styleOpen)} title="Every setting of the look">
          Style…
        </Button>
        <Button onClick={onFrame} title="Frame the model (double-click the view)">
          Frame
        </Button>
        {!hasModel && (
          <Button onClick={openModel} title="Open a glTF, GLB, FBX or OBJ model">
            Open Model…
          </Button>
        )}
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
