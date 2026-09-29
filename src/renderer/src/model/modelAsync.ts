// Promise wrappers around the model worker.

import type { Bvh } from './bvh'
import type { ModelSource } from './load'
import type { ModelData } from './model'
import type { GBufferRequest, ModelRequest, ModelResponse } from './model.worker'
import ModelWorker from './model.worker?worker'
import type { GBuffer } from './raster'

let worker: Worker | null = null
let nextId = 0
const pending = new Map<number, { resolve(response: ModelResponse): void; reject(e: Error): void }>()

/** A request without its id (Omit applied to each member of the union). */
type Request = ModelRequest extends infer R ? (R extends unknown ? Omit<R, 'id'> : never) : never

function request(message: Request, transfer: Transferable[] = []): Promise<ModelResponse> {
  if (!worker) {
    worker = new ModelWorker()
    worker.onmessage = (e: MessageEvent<ModelResponse>) => {
      const job = pending.get(e.data.id)
      pending.delete(e.data.id)
      if (!job) return
      if ('error' in e.data) job.reject(new Error(e.data.error))
      else job.resolve(e.data)
    }
  }
  return new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    worker!.postMessage({ ...message, id } as ModelRequest, transfer)
  })
}

/** Parses a model file and builds its BVH. The worker keeps it for later G-buffer requests. */
export async function loadModelAsync(source: ModelSource): Promise<{ model: ModelData; bvh: Bvh }> {
  const response = await request({ type: 'load', source })
  if (!('model' in response)) throw new Error('Unexpected reply from the model worker.')
  return response
}

/** Draws one material of the loaded model into texture space (see rasterizeUv). */
export async function gbufferAsync(options: GBufferRequest): Promise<GBuffer> {
  const response = await request({ type: 'gbuffer', ...options })
  if (!('gbuffer' in response)) throw new Error('Unexpected reply from the model worker.')
  return response.gbuffer
}
