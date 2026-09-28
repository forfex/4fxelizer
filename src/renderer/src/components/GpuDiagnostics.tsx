import { useEffect, useState } from 'react'
import type { MainGpuInfo, RendererGpuReport } from '@shared/api'
import { getEngine } from '@/engine'
import { collectGpuReport } from '@/gpu/report'
import { useApp } from '@/store'
import { Button } from './ui/button'
import { Dialog, DialogContent } from './ui/dialog'
import { Led } from './ui/retro'

interface Diagnostics {
  renderer: RendererGpuReport
  main: MainGpuInfo | { error: string }
}

export function GpuDiagnostics() {
  const open = useApp((s) => s.diagnosticsOpen)
  const setOpen = useApp((s) => s.setDiagnosticsOpen)
  const [data, setData] = useState<Diagnostics | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    setData(null)
    setCopied(false)
    Promise.all([
      collectGpuReport(getEngine()?.gpu),
      window.fx.getGpuInfo().catch((e: Error) => ({ error: e.message }))
    ]).then(([renderer, main]) => setData({ renderer, main }))
  }, [open])

  const json = data ? JSON.stringify(data, null, 2) : ''

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title="GPU Diagnostics">
        {!data ? (
          <p className="text-dim">Running checks…</p>
        ) : (
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1">
              <dt className="text-dim">WebGPU</dt>
              <dd className="flex items-center gap-1.5">
                <Led state={data.renderer.webgpu ? 'on' : 'error'} />
                {data.renderer.webgpu ? 'Available' : data.renderer.error}
              </dd>
              <dt className="text-dim">Adapter</dt>
              <dd>{data.renderer.adapter?.description ?? '—'}</dd>
              <dt className="text-dim">Pipeline test</dt>
              <dd className="flex items-center gap-1.5">
                <Led state={data.renderer.smokeTest?.ok ? 'on' : 'error'} />
                {data.renderer.smokeTest?.detail ?? '—'}
              </dd>
              {'error' in data.main ? (
                <>
                  <dt className="text-dim">Main process</dt>
                  <dd className="text-led-error">{data.main.error}</dd>
                </>
              ) : (
                <>
                  <dt className="text-dim">Platform</dt>
                  <dd>
                    {data.main.platform} {data.main.arch} · Electron {data.main.versions.electron} · Chrome{' '}
                    {data.main.versions.chrome}
                  </dd>
                  <dt className="text-dim">GPU flags</dt>
                  <dd className="font-mono">{data.main.commandLineFlags.join(' ') || 'none'}</dd>
                </>
              )}
            </dl>
            <pre className="bevel-sunken max-h-80 overflow-auto bg-well p-2 font-mono text-small select-text">{json}</pre>
            <div className="flex justify-end">
              <Button
                onClick={() => navigator.clipboard.writeText(json).then(() => setCopied(true))}
              >
                {copied ? 'Copied' : 'Copy report'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
