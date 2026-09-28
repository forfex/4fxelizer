import { useEffect, useState } from 'react'
import { describeOutput, exportImage, type ExportFormat, type OutputSummary } from '@/actions'
import type { DitherParams } from '@/gpu/passes/dither'
import type { QuantizeParams } from '@/gpu/passes/quantize'
import { indexedBitDepth } from '@/image/png'
import { savedSettings, saveSettings } from '@/settings'
import { snapsColors } from '@/stack/analyze'
import { useApp } from '@/store'
import { Button } from './ui/button'
import { Field, Segmented } from './ui/controls'
import { Dialog, DialogClose, DialogContent } from './ui/dialog'
import { Select } from './ui/select'

const IMAGE_COLORS = '__image'

/** Palette the result was most likely snapped to: the output lock's, else the last snapping stage's. */
function likelyPalette(): string | null {
  const { outputLock, stages } = useApp.getState()
  if (outputLock.enabled && outputLock.paletteId) return outputLock.paletteId
  const last = [...stages].reverse().find(snapsColors)
  const params = last?.params as QuantizeParams | DitherParams | undefined
  return params && params.mode === 'palette' ? params.paletteId : null
}

export function ExportDialog() {
  const open = useApp((s) => s.exportOpen)
  const setOpen = useApp((s) => s.setExportOpen)
  const palettes = useApp((s) => s.palettes)
  const [format, setFormat] = useState<ExportFormat>(() => savedSettings().exportFormat)
  const [paletteChoice, setPaletteChoice] = useState<string>(IMAGE_COLORS)
  const [output, setOutput] = useState<OutputSummary | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setOutput(null)
    setPaletteChoice(likelyPalette() ?? IMAGE_COLORS)
    describeOutput().then(setOutput, () => setOutput(null))
  }, [open])

  const palette = palettes.find((p) => p.id === paletteChoice)
  const tooManyColors = format === 'png-indexed' && !palette && output !== null && output.colors > 256
  // Fully transparent pixels share one extra entry at index 0 when exporting against a palette.
  const entries = output && (palette ? palette.colors.length + (output.transparent ? 1 : 0) : output.colors)
  let summary = ''
  if (format === 'png-rgba') summary = '32-bit RGBA, every color and alpha value kept exactly.'
  else if (entries && entries <= 256) {
    summary = `${entries} palette entries → ${indexedBitDepth(entries)}-bit indexed`
    if (output.transparent) summary += ', transparent pixels at index 0'
    if (entries === 17 && output.transparent) summary += '. Use 15 colors to fit 4-bit (16 entries) with transparency'
    summary += '.'
  }

  const run = async (): Promise<void> => {
    setBusy(true)
    const ok = await exportImage({ format, paletteId: format === 'png-indexed' ? (palette?.id ?? null) : null })
    setBusy(false)
    if (ok) setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title="Export" className="w-[min(460px,90vw)]">
        <div className="flex flex-col gap-2.5">
          <Field label="Format">
            <Segmented<ExportFormat>
              className="flex-1"
              value={format}
              onChange={(f) => {
                setFormat(f)
                saveSettings({ exportFormat: f })
              }}
              options={[
                { value: 'png-indexed', label: 'PNG indexed', hint: 'Palette-based PNG (1/2/4/8-bit), like game textures.' },
                { value: 'png-rgba', label: 'PNG RGBA', hint: 'Full-color PNG.' }
              ]}
            />
          </Field>
          {format === 'png-indexed' && (
            <Field label="Palette" hint="Which palette the PNG stores. A project palette keeps its color order.">
              <Select
                className="flex-1"
                value={paletteChoice}
                onValueChange={setPaletteChoice}
                options={[
                  { value: IMAGE_COLORS, label: 'Colors in the image' },
                  ...palettes.map((p) => ({ value: p.id, label: `${p.name} (${p.colors.length})` }))
                ]}
              />
            </Field>
          )}
          <dl className="bevel-sunken grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 bg-well p-2">
            <dt className="text-dim">Size</dt>
            <dd className="font-mono">{output ? `${output.width} × ${output.height}` : '…'}</dd>
            <dt className="text-dim">Colors</dt>
            <dd className="font-mono">{output ? (output.colors > 256 ? 'more than 256' : output.colors) : '…'}</dd>
          </dl>
          <p className="text-small text-dim">{summary}</p>
          {tooManyColors && (
            <p className="text-small text-led-warn">
              The result has more than 256 colors. Add a Quantize or Dither stage, or turn on the output palette lock.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
            <Button variant="primary" onClick={run} disabled={busy || tooManyColors}>
              {busy ? 'Exporting…' : 'Export…'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
