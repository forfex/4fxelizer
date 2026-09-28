import { useEffect, useState } from 'react'
import { EXPORT_FILE_TYPES } from '@shared/api'
import { describeOutput, ENCODERS, exportImage, parseExportFormat, type ExportFormat, type OutputSummary } from '@/actions'
import type { DitherParams } from '@/gpu/passes/dither'
import type { QuantizeParams } from '@/gpu/passes/quantize'
import { MAX_INDEXED } from '@/palette/palette'
import { savedSettings, saveSettings } from '@/settings'
import { snapsColors } from '@/stack/analyze'
import { useApp } from '@/store'
import { Button } from './ui/button'
import { Field, Segmented } from './ui/controls'
import { Dialog, DialogClose, DialogContent } from './ui/dialog'
import { Select } from './ui/select'

const IMAGE_COLORS = '__image'

const FILE_HINTS = {
  png: 'Compressed and lossless. Indexed PNGs use 1/2/4/8 bits per pixel.',
  tga: 'Uncompressed Targa, common in game pipelines. Indexed TGAs use 8 bits per pixel.',
  bmp: 'Uncompressed bitmap. Indexed BMPs use 1/4/8 bits per pixel and have no transparency.'
} as const

/**
 * Palette the result was most likely snapped to: the output lock's, else the last snapping stage's.
 * Only palettes that fit an indexed image.
 */
function likelyPalette(): string | null {
  const { outputLock, stages, palettes } = useApp.getState()
  const last = [...stages].reverse().find(snapsColors)
  const params = last?.params as QuantizeParams | DitherParams | undefined
  const id = outputLock.enabled && outputLock.paletteId ? outputLock.paletteId : params?.mode === 'palette' ? params.paletteId : null
  const palette = palettes.find((p) => p.id === id)
  return palette && palette.colors.length <= MAX_INDEXED ? palette.id : null
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

  const { type, indexed } = parseExportFormat(format)
  const encoder = ENCODERS[type]
  const chooseFormat = (f: ExportFormat): void => {
    setFormat(f)
    saveSettings({ exportFormat: f })
  }
  const palette = palettes.find((p) => p.id === paletteChoice)
  // Fully transparent pixels share one extra entry at index 0 when exporting against a palette.
  const entries = output && (palette ? palette.colors.length + (output.transparent ? 1 : 0) : output.colors)
  const tooManyColors = indexed && entries !== null && entries > MAX_INDEXED
  let summary = ''
  if (!indexed) {
    summary =
      type === 'png'
        ? '32-bit RGBA, every color and alpha value kept exactly.'
        : '24-bit, or 32-bit with straight alpha when the image has transparency; every color kept exactly.'
  } else if (entries && entries <= 256) {
    const depth = encoder.indexedDepth(entries)
    summary = `${entries} palette entries → ${depth}-bit indexed`
    if (output.transparent) {
      summary += type === 'bmp' ? '. BMP has no transparency: transparent pixels use index 0 (black)' : ', transparent pixels at index 0'
    }
    if (entries === 17 && output.transparent && depth === 8 && encoder.indexedDepth(16) === 4) {
      summary += '. Use 15 colors to fit 4-bit (16 entries) with transparency'
    }
    summary += '.'
  }

  const run = async (): Promise<void> => {
    setBusy(true)
    const ok = await exportImage({ format, paletteId: indexed ? (palette?.id ?? null) : null })
    setBusy(false)
    if (ok) setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title="Export" className="w-[min(460px,90vw)]">
        <div className="flex flex-col gap-2.5">
          <Field label="Format">
            <Segmented
              className="flex-1"
              value={type}
              onChange={(t) => chooseFormat(`${t}-${indexed ? 'indexed' : 'rgba'}`)}
              options={EXPORT_FILE_TYPES.map((t) => ({ value: t, label: ENCODERS[t].label, hint: FILE_HINTS[t] }))}
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
          {indexed && (
            <Field label="Palette" hint="Which palette the file stores. A project palette keeps its color order.">
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
              {palette
                ? `"${palette.name}" has ${entries} entries; indexed images allow 256. Pick a smaller palette or "Colors in the image".`
                : 'The result has more than 256 colors. Add a Quantize or Dither stage, or turn on the output palette lock.'}
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
