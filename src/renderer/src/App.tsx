import { useEffect, useState } from 'react'
import { openDroppedFile, redo, runMenuCommand } from '@/actions'
import { startEngine } from '@/engine'
import { adapterLabel } from '@/gpu/device'
import { startPaletteController } from '@/palette/controller'
import { useApp } from '@/store'
import { ExportDialog } from './components/ExportDialog'
import { GpuDiagnostics } from './components/GpuDiagnostics'
import { PalettePanel } from './components/PalettePanel'
import { StackPanel } from './components/StackPanel'
import { StatusBar } from './components/StatusBar'
import { Toolbar } from './components/Toolbar'
import { Viewer } from './components/Viewer'

export function App() {
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const { setGpu } = useApp.getState()
    // StrictMode runs this effect twice; only the run that wasn't cleaned up may register.
    let cancelled = false
    let stopController: (() => void) | undefined
    startEngine()
      .then((engine) => {
        if (cancelled) return
        stopController = startPaletteController(engine)
        setGpu({ status: 'ready', adapter: adapterLabel(engine.gpu.adapter) })
        engine.gpu.device.lost.then((info) => {
          setGpu({ status: 'error', message: `GPU device lost (${info.reason}): ${info.message}` })
        })
      })
      .catch((e: Error) => setGpu({ status: 'error', message: e.message }))
    return () => {
      cancelled = true
      stopController?.()
    }
  }, [])

  useEffect(() => window.fx.onMenuCommand(runMenuCommand), [])

  // Ctrl+Shift+Z as a second redo shortcut on Windows/Linux (the menu shows Ctrl+Y).
  useEffect(() => {
    if (window.fx.platform === 'darwin') return
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) await openDroppedFile(file.name, new Uint8Array(await file.arrayBuffer()))
  }

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <StackPanel />
        <main className="flex min-w-0 flex-1 p-1.5">
          <Viewer />
        </main>
        <PalettePanel />
      </div>
      <StatusBar />
      <GpuDiagnostics />
      <ExportDialog />
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 border-2 border-dashed border-accent bg-accent/5" />
      )}
    </div>
  )
}
