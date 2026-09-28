// GPU copies of project resources that passes read: palettes (storage buffers) and the
// shared blue-noise pattern.
//
// A palette buffer holds each color twice, sorted two ways (see the palette section of
// wgslLib.ts), so shader palette indices are buffer positions, not palette order.

import { blueNoise64 } from '@/dither/blueNoise'
import { hexToOklab, hexToRgb8, paletteSignature, type Palette } from '@/palette/palette'
import { PALETTE_ENTRY_BYTES } from './pass'

export interface GpuPalette {
  buffer: GPUBuffer
  count: number
  signature: string
}

export class GpuResources {
  readonly pattern: GPUTexture
  /** Bound when a pass reads no palette (bindings can't be empty). */
  readonly emptyPalette: GPUBuffer
  private readonly palettes = new Map<string, GpuPalette>()

  constructor(private readonly device: GPUDevice) {
    this.emptyPalette = device.createBuffer({
      label: 'empty palette',
      size: PALETTE_ENTRY_BYTES,
      usage: GPUBufferUsage.STORAGE
    })
    const noise = blueNoise64()
    this.pattern = device.createTexture({
      label: 'blue noise',
      size: [64, 64],
      format: 'r8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    })
    device.queue.writeTexture({ texture: this.pattern }, noise as Uint8Array<ArrayBuffer>, { bytesPerRow: 64 }, [64, 64])
  }

  /** Uploads new or changed palettes and frees removed ones. */
  syncPalettes(palettes: Palette[]): void {
    const ids = new Set(palettes.map((p) => p.id))
    for (const [id, gpu] of this.palettes) {
      if (!ids.has(id)) {
        gpu.buffer.destroy()
        this.palettes.delete(id)
      }
    }
    for (const p of palettes) {
      const signature = paletteSignature(p)
      const existing = this.palettes.get(p.id)
      if (existing?.signature === signature) continue
      existing?.buffer.destroy()
      const count = p.colors.length
      const data = new Float32Array(Math.max(count * 2, 1) * (PALETTE_ENTRY_BYTES / 4))
      const entries = p.colors.map((c) => {
        const [r, g, b] = hexToRgb8(c.hex)
        const rgb = [r / 255, g / 255, b / 255]
        return { rgb, lab: hexToOklab(c.hex), rgbKey: (rgb[0]! + rgb[1]! + rgb[2]!) / Math.sqrt(3) }
      })
      // Two sorted copies for the pruned nearest-color search in wgslLib.ts; the sort key goes in lab.w.
      const byLightness = [...entries].sort((a, b) => a.lab[0] - b.lab[0])
      const byRgbSum = [...entries].sort((a, b) => a.rgbKey - b.rgbKey)
      byLightness.forEach((e, i) => data.set([...e.rgb, 1, ...e.lab, e.lab[0]], i * 8))
      byRgbSum.forEach((e, i) => data.set([...e.rgb, 1, ...e.lab, e.rgbKey], (count + i) * 8))
      const buffer = this.device.createBuffer({
        label: `palette ${p.name}`,
        size: data.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      })
      this.device.queue.writeBuffer(buffer, 0, data)
      this.palettes.set(p.id, { buffer, count, signature })
    }
  }

  palette(id: string | null | undefined): GpuPalette | null {
    return (id && this.palettes.get(id)) || null
  }

  dispose(): void {
    for (const p of this.palettes.values()) p.buffer.destroy()
    this.palettes.clear()
    this.emptyPalette.destroy()
    this.pattern.destroy()
  }
}
