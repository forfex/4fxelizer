// Model work off the UI thread: parsing the file and building its BVH, then drawing bake G-buffers.
// The worker keeps the last loaded model, so G-buffer requests only send their settings.

import { buildBvh, leafIndexOf, type Bvh } from './bvh'
import { parseModel, type ModelSource } from './load'
import type { ModelData } from './model'
import { rasterizeUv, type GBuffer } from './raster'

export interface GBufferRequest {
  /** Materials (texture sets) drawn: the ones sharing the texture baked for. */
  materials: number[]
  uvSet: number
  width: number
  height: number
  padding: number
}

export type ModelRequest = { id: number } & ({ type: 'load'; source: ModelSource } | ({ type: 'gbuffer' } & GBufferRequest))

export type ModelResponse =
  | { id: number; model: ModelData; bvh: Bvh }
  | { id: number; gbuffer: GBuffer }
  | { id: number; error: string }

let current: { model: ModelData; leafIndex: Uint32Array } | null = null

async function handle(request: ModelRequest): Promise<void> {
  if (request.type === 'load') {
    current = null
    const model = await parseModel(request.source)
    const bvh = buildBvh(model.positions, model.indices)
    current = { model, leafIndex: leafIndexOf(bvh) }
    self.postMessage({ id: request.id, model, bvh } satisfies ModelResponse)
    return
  }
  if (!current) throw new Error('No model is loaded.')
  const { model, leafIndex } = current
  const ranges = request.materials.map((m) => model.parts[m])
  const uv = model.uvSets[request.uvSet]
  if (!ranges.length || ranges.some((r) => !r) || !uv) throw new Error('That material or UV set isn’t in the model.')
  const gbuffer = rasterizeUv(
    { positions: model.positions, normals: model.normals, uv, indices: model.indices, first: 0, count: 0, ranges: ranges as { first: number; count: number }[], leafIndex },
    request.width,
    request.height,
    request.padding
  )
  self.postMessage({ id: request.id, gbuffer } satisfies ModelResponse, { transfer: [gbuffer.position.buffer, gbuffer.normal.buffer] })
}

self.onmessage = (e: MessageEvent<ModelRequest>) => {
  handle(e.data).catch((err: unknown) => {
    self.postMessage({ id: e.data.id, error: err instanceof Error ? err.message : String(err) } satisfies ModelResponse)
  })
}
