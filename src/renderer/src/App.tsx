import { useEffect, useState } from 'react'
import { openDroppedFiles, redo, runMenuCommand } from '@/actions'
import { startEngine } from '@/engine'
import { adapterLabel } from '@/gpu/device'
import { startPaletteController } from '@/palette/controller'
import { useApp } from '@/store'
import { ExportDialog } from './components/ExportDialog'
import { GpuDiagnostics } from './components/GpuDiagnostics'
import { PresetsDialog } from './components/Presets'
import { SettingsDialog } from './components/settings/SettingsDialog'
import { StatusBar } from './components/StatusBar'
import { TitleBar } from './components/TitleBar'
import { Toolbar } from './components/Toolbar'
import { UnsavedDialog } from './components/UnsavedDialog'
import { DockArea } from './components/Workspace'

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
    const files = await Promise.all(
      [...e.dataTransfer.files].map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()), path: window.fx.pathForFile(f) || undefined }))
    )
    if (files.length) await openDroppedFiles(files)
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
      <TitleBar />
      <Toolbar />
      {/* `isolate` keeps dockview's high z-indexes (floating panels) below menus and dialogs. */}
      <div className="isolate flex min-h-0 flex-1 flex-col">
        <DockArea />
      </div>
      <StatusBar />
      <GpuDiagnostics />
      <ExportDialog />
      <PresetsDialog />
      <SettingsDialog />
      <UnsavedDialog />
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 border-2 border-dashed border-accent bg-accent/5" />
      )}
    </div>
  )
}
