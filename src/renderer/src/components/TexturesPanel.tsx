// The open textures with previews of their source and result: click one to work on it, switch
// it between the shared stack and a separate one, close it, or open more.

import { useEffect, useState } from 'react'
import { closeTexture, openImage } from '@/actions'
import { getEngine } from '@/engine'
import type { RgbaImage } from '@/image/png'
import { cn } from '@/lib/utils'
import { useApp } from '@/store'
import type { TextureEntry } from '@/stack/textures'
import { Button } from './ui/button'
import { Segmented } from './ui/controls'
import { GroupBox, PanelBody } from './ui/retro'
import { CloseIcon } from './ui/retro'

/** Longest side of a result preview, in texels. */
const PREVIEW_SIDE = 128
/** Wait after a texture's stack ran before reading its preview back (slider drags run it every frame). */
const PREVIEW_DELAY_MS = 250

function toDataUrl(image: RgbaImage): string {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0)
  return canvas.toDataURL()
}

/** Previews of every texture's result, refreshed after its stack runs. */
function useResultPreviews(): Record<string, string> {
  const gpuReady = useApp((s) => s.gpu.status === 'ready')
  const [previews, setPreviews] = useState<Record<string, string>>({})
  useEffect(() => {
    const engine = getEngine()
    if (!gpuReady || !engine) return
    const timers = new Map<string, number>()
    const refresh = (id: string): void => {
      window.clearTimeout(timers.get(id))
      timers.set(
        id,
        window.setTimeout(async () => {
          timers.delete(id)
          const { plan } = engine.planOf(id)
          if (!plan) return
          try {
            const url = toDataUrl(await engine.samplePixels(plan.outputKey, PREVIEW_SIDE, id))
            setPreviews((p) => ({ ...p, [id]: url }))
          } catch {
            // The texture closed, or its result changed meanwhile: the next run refreshes it.
          }
        }, PREVIEW_DELAY_MS)
      )
    }
    for (const t of useApp.getState().textures) refresh(t.id)
    const off = engine.onPlan((_plan, _key, id) => refresh(id))
    return () => {
      off()
      for (const t of timers.values()) window.clearTimeout(t)
    }
  }, [gpuReady])
  return previews
}

export function TexturesPanel() {
  const textures = useApp((s) => s.textures)
  const gpuReady = useApp((s) => s.gpu.status === 'ready')
  const previews = useResultPreviews()
  return (
    <PanelBody>
      <GroupBox title={textures.length ? `Textures · ${textures.length}` : 'Textures'}>
        <div className="flex flex-col gap-2">
          {textures.length === 0 && <p className="text-small text-dim">No texture open. Open several at once, or drop them on the window.</p>}
          <div className="grid grid-cols-1 gap-2 @min-[420px]/panel:grid-cols-2">
            {textures.map((t) => (
              <TextureCard key={t.id} texture={t} preview={previews[t.id] ?? null} />
            ))}
          </div>
          <div className="flex justify-end gap-1">
            <Button size="sm" disabled={!gpuReady} onClick={() => void openImage()} title="Open textures (several at once)">
              Add textures…
            </Button>
          </div>
        </div>
      </GroupBox>
    </PanelBody>
  )
}

function TextureCard({ texture, preview }: { texture: TextureEntry; preview: string | null }) {
  const active = useApp((s) => s.activeTextureId === texture.id)
  const separate = useApp((s) => !!s.docs.separate[texture.id])
  const { image } = texture
  const select = (): void => useApp.getState().selectTexture(texture.id)
  return (
    <div
      className={cn(
        'bevel-raised flex min-w-0 flex-col gap-1.5 rounded-fx border-px bg-panel-hi p-1.5',
        active ? 'border-accent outline-px outline-accent' : 'border-edge'
      )}
      onClick={select}
    >
      <div className="flex items-center gap-1">
        <button type="button" className="min-w-0 flex-1 truncate text-left font-semibold" title={image.path ?? image.name} onClick={select}>
          {image.name}
        </button>
        <button
          type="button"
          aria-label={`Close ${image.name}`}
          title="Close this texture"
          className="flex size-5 shrink-0 items-center justify-center rounded-[2px] text-dim hover:bg-hover hover:text-text"
          onClick={(e) => {
            e.stopPropagation()
            closeTexture(texture.id)
          }}
        >
          <CloseIcon className="size-3" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1">
        <Thumb src={texture.thumbnail} label="Source" />
        <Thumb src={preview} label="Result" />
      </div>
      <div className="flex items-center gap-2 text-small text-dim">
        <span className="font-mono">
          {image.width} × {image.height}
        </span>
        <span className="ml-auto" onClick={(e) => e.stopPropagation()}>
          <Segmented
            value={separate ? 'separate' : 'shared'}
            onChange={(v) => useApp.getState().setTextureStack(texture.id, v)}
            options={[
              { value: 'shared', label: 'Shared', hint: 'Processed with the shared stack.' },
              { value: 'separate', label: 'Separate', hint: 'Processed with a stack of its own (starts as a copy of the shared one).' }
            ]}
          />
        </span>
      </div>
    </div>
  )
}

function Thumb({ src, label }: { src: string | null; label: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="bevel-sunken flex aspect-square items-center justify-center overflow-hidden bg-well">
        {src ? <img src={src} alt={label} className="size-full object-contain [image-rendering:pixelated]" /> : <span className="text-small text-faint">—</span>}
      </div>
      <span className="text-center text-small text-dim label-caps">{label}</span>
    </div>
  )
}
