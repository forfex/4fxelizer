import { useEffect, useState } from 'react'
import { loadImageFile, runMenuCommand } from '@/actions'
import { startEngine } from '@/engine'
import { adapterLabel } from '@/gpu/device'
import { useApp } from '@/store'
import { GpuDiagnostics } from './components/GpuDiagnostics'
import { StackPanel } from './components/StackPanel'
import { StatusBar } from './components/StatusBar'
import { Toolbar } from './components/Toolbar'
import { Viewer } from './components/Viewer'

export function App() {
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const { setGpu } = useApp.getState()
    startEngine()
      .then((engine) => {
        setGpu({ status: 'ready', adapter: adapterLabel(engine.gpu.adapter) })
        engine.gpu.device.lost.then((info) => {
          setGpu({ status: 'error', message: `GPU device lost (${info.reason}): ${info.message}` })
        })
      })
      .catch((e: Error) => setGpu({ status: 'error', message: e.message }))
  }, [])

  useEffect(() => window.fx.onMenuCommand(runMenuCommand), [])

  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) await loadImageFile(file.name, new Uint8Array(await file.arrayBuffer()))
  }

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={(e) => {
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
      </div>
      <StatusBar />
      <GpuDiagnostics />
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 border-2 border-dashed border-accent bg-accent/5" />
      )}
    </div>
  )
}
