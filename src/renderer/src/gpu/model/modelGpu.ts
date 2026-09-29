// GPU copies of the loaded model: vertex and index buffers for the 3D view (storage buffers: its
// shader pulls vertices by index), and the BVH the bake shaders trace rays through.

import type { Bvh } from '@/model/bvh'
import type { ModelData } from '@/model/model'

/** Vertex layout: position (3 floats), normal (3), uv (2). */
export const VERTEX_FLOATS = 8

function buffer(device: GPUDevice, label: string, data: ArrayBufferView<ArrayBuffer>, usage: number): GPUBuffer {
  // Storage and vertex buffers must be a multiple of 4 bytes and not empty.
  const size = Math.max(Math.ceil(data.byteLength / 4) * 4, 16)
  const b = device.createBuffer({ label, size, usage: usage | GPUBufferUsage.COPY_DST })
  device.queue.writeBuffer(b, 0, data)
  return b
}

export class ModelGpu {
  readonly index: GPUBuffer
  private readonly vertices = new Map<number, GPUBuffer>()
  private bvhBuffers: { nodes: GPUBuffer; triangles: GPUBuffer } | null = null

  constructor(
    private readonly device: GPUDevice,
    readonly data: ModelData,
    readonly bvh: Bvh
  ) {
    this.index = buffer(device, 'model indices', data.indices as Uint32Array<ArrayBuffer>, GPUBufferUsage.STORAGE)
  }

  /** Interleaved vertices with the given UV set (zeros when the model has none); indexed by `index`. */
  vertexBuffer(uvSet: number): GPUBuffer {
    const set = Math.min(uvSet, Math.max(this.data.uvSets.length - 1, 0))
    let b = this.vertices.get(set)
    if (!b) {
      const { positions, normals } = this.data
      const uv = this.data.uvSets[set]
      const count = positions.length / 3
      const data = new Float32Array(count * VERTEX_FLOATS)
      for (let i = 0; i < count; i++) {
        const o = i * VERTEX_FLOATS
        data[o] = positions[i * 3]!
        data[o + 1] = positions[i * 3 + 1]!
        data[o + 2] = positions[i * 3 + 2]!
        data[o + 3] = normals[i * 3]!
        data[o + 4] = normals[i * 3 + 1]!
        data[o + 5] = normals[i * 3 + 2]!
        data[o + 6] = uv ? uv[i * 2]! : 0
        data[o + 7] = uv ? uv[i * 2 + 1]! : 0
      }
      b = buffer(this.device, `model vertices (UV ${set + 1})`, data, GPUBufferUsage.STORAGE)
      this.vertices.set(set, b)
    }
    return b
  }

  /** BVH nodes and triangles as storage buffers (uploaded on first use). */
  bvhStorage(): { nodes: GPUBuffer; triangles: GPUBuffer } {
    this.bvhBuffers ??= {
      nodes: buffer(this.device, 'bvh nodes', this.bvh.nodes, GPUBufferUsage.STORAGE),
      triangles: buffer(this.device, 'bvh triangles', this.bvh.triangles, GPUBufferUsage.STORAGE)
    }
    return this.bvhBuffers
  }

  dispose(): void {
    this.index.destroy()
    for (const b of this.vertices.values()) b.destroy()
    this.vertices.clear()
    this.bvhBuffers?.nodes.destroy()
    this.bvhBuffers?.triangles.destroy()
    this.bvhBuffers = null
  }
}
