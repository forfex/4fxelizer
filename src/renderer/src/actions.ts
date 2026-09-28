import type { MenuCommand } from '@shared/api'
import { getEngine } from '@/engine'
import { decodeImage } from '@/image/decode'
import { useApp } from '@/store'

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export async function loadImageFile(name: string, bytes: Uint8Array): Promise<void> {
  const engine = getEngine()
  const { setMessage, setImage } = useApp.getState()
  if (!engine) return
  try {
    const bitmap = await decodeImage(name, bytes)
    engine.loadBitmap(bitmap)
    setImage({ name, width: bitmap.width, height: bitmap.height })
    bitmap.close()
    setMessage({ kind: 'info', text: `Loaded ${name}` })
  } catch (e) {
    setMessage({ kind: 'error', text: errorText(e) })
  }
}

export async function openImage(): Promise<void> {
  const file = await window.fx.openImage()
  if (file) await loadImageFile(file.name, file.bytes)
}

export async function exportImage(): Promise<void> {
  const engine = getEngine()
  const { image, setMessage } = useApp.getState()
  if (!engine || !image) return
  try {
    const bytes = await engine.exportPng()
    const path = await window.fx.saveImage(`${image.name.replace(/\.[^.]+$/, '')}_4fx.png`, bytes)
    if (path) setMessage({ kind: 'info', text: `Saved ${path}` })
  } catch (e) {
    setMessage({ kind: 'error', text: `Export failed: ${errorText(e)}` })
  }
}

export function runMenuCommand(command: MenuCommand): void {
  const app = useApp.getState()
  switch (command) {
    case 'open': return void openImage()
    case 'export': return void exportImage()
    case 'zoom-fit': return app.zoomFit()
    case 'zoom-actual': return app.zoomActual()
    case 'zoom-in': return app.zoomStep(1)
    case 'zoom-out': return app.zoomStep(-1)
    case 'toggle-grid': return app.toggleGrid()
    case 'toggle-split': return app.toggleSplit()
    case 'gpu-diagnostics': return app.setDiagnosticsOpen(true)
  }
}
