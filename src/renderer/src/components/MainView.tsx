// The main view (the dock's viewer panel): the 2D viewer, the 2D viewer and the 3D view side by
// side, or the 3D view alone, switched in the toolbar or the View menu. The 2D viewer stays mounted
// in the 3D mode (hidden, keeping its size): it runs the stack, whose result the 3D view shows.

import { useRef } from 'react'
import { cn } from '@/lib/utils'
import { useApp } from '@/store'
import { View3d } from './View3dPanel'
import { Viewer } from './Viewer'

export function MainView() {
  const mode = useApp((s) => s.viewMode)
  const share = useApp((s) => s.viewSplit)
  const root = useRef<HTMLDivElement>(null)
  return (
    <div ref={root} className="relative flex h-full min-h-0 bg-panel p-1.5">
      <div
        className={cn('flex min-h-0 min-w-0', mode === '3d' ? 'invisible absolute inset-1.5' : 'flex-1')}
        style={mode === 'split' ? { flex: `${share} 1 0` } : undefined}
        aria-hidden={mode === '3d' || undefined}
      >
        <Viewer />
      </div>
      {mode === 'split' && <Divider root={root} />}
      {mode !== '2d' && (
        <div className="flex min-h-0 min-w-0 flex-1" style={mode === 'split' ? { flex: `${1 - share} 1 0` } : undefined}>
          <View3d />
        </div>
      )}
    </div>
  )
}

/** The draggable bar between the 2D and 3D views. */
function Divider({ root }: { root: React.RefObject<HTMLDivElement | null> }) {
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const el = root.current
    if (!e.currentTarget.hasPointerCapture(e.pointerId) || !el) return
    const rect = el.getBoundingClientRect()
    useApp.getState().setViewSplit((e.clientX - rect.left) / Math.max(rect.width, 1))
  }
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="2D / 3D divider"
      title="Drag to resize the 2D and 3D views (double-click to even them)"
      className="group flex w-1.5 shrink-0 cursor-ew-resize justify-center"
      onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
      onPointerMove={onPointerMove}
      onDoubleClick={() => useApp.getState().setViewSplit(0.5)}
    >
      <div className="h-full w-(--px) group-hover:bg-accent group-active:bg-accent" />
    </div>
  )
}
