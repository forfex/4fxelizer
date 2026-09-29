// A loaded 3D model, flattened into plain typed arrays so it can move between the worker and the
// UI thread and go straight into GPU buffers.

import type { ModelFormat } from '@shared/model'

/** Where a material's base color texture comes from. */
export type TextureRef =
  /** A file the model refers to (resolved next to the model by main, see readModelFile). */
  | { kind: 'file'; reference: string }
  /** Bytes stored inside the model (GLB, embedded FBX media, data URIs). */
  | { kind: 'embedded'; name: string; bytes: Uint8Array }

export interface ModelMaterial {
  name: string
  /** Base color (sRGB, 0–1), used for parts drawn without the open texture. */
  color: [number, number, number]
  texture: TextureRef | null
}

export interface ModelData {
  name: string
  format: ModelFormat
  /** World-space positions, 3 floats per vertex. */
  positions: Float32Array
  /** World-space normals, 3 floats per vertex. */
  normals: Float32Array
  /**
   * UV sets (the first is the one textures normally use), 2 floats per vertex. v points down the
   * image, as in glTF: texel = (u·width, v·height). Files with v pointing up are flipped on load.
   */
  uvSets: Float32Array[]
  /** 3 vertex indices per triangle, grouped by material (see `parts`). */
  indices: Uint32Array
  /** Triangle range of each material, by material index. */
  parts: { first: number; count: number }[]
  materials: ModelMaterial[]
  bounds: { min: [number, number, number]; max: [number, number, number] }
  /** Problems worth telling the user about (missing UVs, …). */
  warnings: string[]
}

export const triangleCount = (m: Pick<ModelData, 'indices'>): number => m.indices.length / 3
export const vertexCount = (m: Pick<ModelData, 'positions'>): number => m.positions.length / 3

/** Length of the bounding box diagonal (the model's scale, for distances relative to its size). */
export function modelSize(m: Pick<ModelData, 'bounds'>): number {
  const { min, max } = m.bounds
  return Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1
}
