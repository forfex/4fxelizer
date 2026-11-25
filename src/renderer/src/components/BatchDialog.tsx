// File › Process Folder: pick a folder of textures, run the current stack on each and export the
// results into another folder. Uses the Export dialog's format.

import { useEffect, useRef, useState } from 'react'
import { EXPORT_FILE_TYPES, type BatchFolder } from '@shared/api'
import { ENCODERS, parseExportFormat, type ExportFormat } from '@/actions'
import { processFolder, type BatchProgress, type BatchResult } from '@/batch'
import { savedSettings, saveSettings } from '@/settings'
import { useApp } from '@/store'
import { likelyPalette } from './ExportDialog'
import { Button } from './ui/button'
import { Field, Segmented } from './ui/controls'
import { Dialog, DialogContent } from './ui/dialog'
import { Led } from './ui/retro'

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export function BatchDialog() {
  const open = useApp((s) => s.batchOpen)
  const setOpen = useApp((s) => s.setBatchOpen)
  const gpuReady = useApp((s) => s.gpu.status === 'ready')
  const stageCount = useApp((s) => s.stages.filter((st) => st.enabled).length)
  const [format, setFormat] = useState<ExportFormat>(() => savedSettings().exportFormat)
  const [input, setInput] = useState<BatchFolder | null>(null)
  const [progress, setProgress] = useState<BatchProgress | null>(null)
  const [result, setResult] = useState<BatchResult | null>(null)
  const [error, setError] = useState('')
  const cancel = useRef(false)
  const running = progress !== null && result === null

  useEffect(() => {
    if (!open) return
    setFormat(savedSettings().exportFormat)
    setInput(null)
    setProgress(null)
    setResult(null)
    setError('')
  }, [open])

  const { type, indexed } = parseExportFormat(format)
  const chooseFormat = (f: ExportFormat): void => {
    setFormat(f)
    saveSettings({ exportFormat: f })
  }

  const chooseInput = async (): Promise<void> => {
    setError('')
    try {
      const picked = await window.fx.chooseBatchFolder()
      if (picked) {
        setInput(picked)
        setResult(null)
        setProgress(null)
      }
    } catch (e) {
      setError(`Couldn't read that folder: ${errorText(e)}`)
    }
  }

  const run = async (): Promise<void> => {
    if (!input?.files.length) return
    const outFolder = await window.fx.chooseExportFolder()
    if (!outFolder) return
    cancel.current = false
    setResult(null)
    setProgress({ done: 0, total: input.files.length, name: '' })
    const done = await processFolder(input, outFolder, { format, paletteId: indexed ? likelyPalette() : null }, setProgress, () => cancel.current)
    setResult(done)
    useApp.getState().setMessage({
      kind: done.failed.length ? 'error' : 'info',
      text: `Processed ${done.written} of ${done.total} textures into ${done.folder}${done.cancelled ? ' (stopped)' : ''}`
    })
  }

  return (
    // While it runs, the window can't be closed by accident (Stop ends the run).
    <Dialog open={open} onOpenChange={(o) => (running ? undefined : setOpen(o))}>
      <DialogContent title="Process folder" className="w-[min(480px,90vw)]">
        <div className="flex flex-col gap-2.5">
          <p className="text-dim">
            Runs the current stack ({stageCount} {stageCount === 1 ? 'stage' : 'stages'} on) on every texture in a folder and saves the results into
            another folder, named like each texture (rock_4fx). The textures are not opened.
          </p>
          <Field label="Textures" hint="The folder with the textures to process. Its subfolders are not included.">
            <Button disabled={running || !gpuReady} onClick={() => void chooseInput()}>
              Choose folder…
            </Button>
            <span className="min-w-0 flex-1 truncate text-dim" title={input?.folder}>
              {input ? `${input.files.length} ${input.files.length === 1 ? 'texture' : 'textures'} in ${input.folder}` : 'No folder chosen'}
            </span>
          </Field>
          <Field label="Format">
            <Segmented
              className="flex-1"
              value={type}
              onChange={(t) => chooseFormat(`${t}-${indexed ? 'indexed' : 'rgba'}`)}
              options={EXPORT_FILE_TYPES.map((t) => ({ value: t, label: ENCODERS[t].label }))}
            />
          </Field>
          <Field label="Colors">
            <Segmented
              className="flex-1"
              value={indexed ? 'indexed' : 'rgba'}
              onChange={(mode) => chooseFormat(`${type}-${mode}`)}
              options={[
                { value: 'indexed', label: 'Indexed', hint: 'Palette-based image (up to 256 colors), like game textures.' },
                { value: 'rgba', label: 'Full color', hint: 'Every pixel stores its own color and alpha.' }
              ]}
            />
          </Field>
          {input && input.files.length === 0 && <p className="text-small text-led-warn">That folder has no textures to process.</p>}
          {error && <p className="text-small text-led-error">{error}</p>}
          {progress && (
            <div className="bevel-sunken flex flex-col gap-1 bg-well p-2">
              <div className="flex items-center gap-2">
                <Led state={result ? (result.failed.length ? 'warn' : 'on') : 'on'} />
                <span className="font-mono">
                  {result ? result.written : progress.done} / {progress.total}
                </span>
                <span className="min-w-0 flex-1 truncate text-dim">
                  {result ? (result.cancelled ? 'Stopped.' : `Saved into ${result.folder}`) : progress.name}
                </span>
              </div>
              {result && result.failed.length > 0 && (
                <ul className="flex max-h-28 flex-col gap-0.5 overflow-y-auto text-small">
                  {result.failed.map((f) => (
                    <li key={f.name} className="text-led-warn">
                      {f.name}: {f.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2">
            {running ? (
              <Button onClick={() => (cancel.current = true)}>Stop</Button>
            ) : (
              <>
                <Button onClick={() => setOpen(false)}>{result ? 'Close' : 'Cancel'}</Button>
                <Button variant="primary" disabled={!input?.files.length || !gpuReady} onClick={() => void run()}>
                  Process…
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
