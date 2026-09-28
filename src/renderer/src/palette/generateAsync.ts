import type { GenerateOptions } from './generate'
import type { GenerateRequest, GenerateResponse } from './palette.worker'
import PaletteWorker from './palette.worker?worker'

let worker: Worker | null = null
let nextId = 0
const pending = new Map<number, { resolve(colors: string[]): void; reject(e: Error): void }>()

function getWorker(): Worker {
  if (!worker) {
    worker = new PaletteWorker()
    worker.onmessage = (e: MessageEvent<GenerateResponse>) => {
      const job = pending.get(e.data.id)
      pending.delete(e.data.id)
      if (!job) return
      if ('error' in e.data) job.reject(new Error(e.data.error))
      else job.resolve(e.data.colors)
    }
  }
  return worker
}

/** Generates palette colors from straight RGBA8 pixels in a worker. */
export function generatePaletteAsync(rgba: Uint8Array<ArrayBuffer>, options: GenerateOptions): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    getWorker().postMessage({ id, rgba, options } satisfies GenerateRequest, [rgba.buffer])
  })
}
