// The bake G-buffer: the model's triangles drawn into texture space (UVs as positions), so every
// texel knows which point of the surface it shows. Done on the CPU in the model worker; the bake
// shaders then trace rays from these points.
//
// Coverage is supersampled: a texel whose center no triangle covers still takes a triangle that
// covers one of four quarter-offset points, so thin triangles don't vanish. Texels whose center lies
// inside more than one triangle are counted (overlapping or mirrored UVs). Empty texels near the
// UV islands are then filled from their neighbors (edge padding), so maps don't show seams when
// they're sampled or downscaled.

export interface GBufferInput {
  positions: Float32Array
  normals: Float32Array
  /** The UV set baked into, 2 floats per vertex (v down). */
  uv: Float32Array
  indices: Uint32Array
  /** Triangle range drawn (one material's triangles). */
  first: number
  count: number
  /** Leaf-order index (see Bvh) of each triangle, stored per texel for the shaders. */
  leafIndex: Uint32Array
}

export interface GBuffer {
  width: number
  height: number
  /** 4 floats per texel: position xyz, and the leaf-order triangle as u32 bits (EMPTY_TRIANGLE = none). */
  position: Float32Array<ArrayBuffer>
  /** 4 floats per texel: normal xyz, and coverage (COVERED, PADDED, or 0 = empty). */
  normal: Float32Array<ArrayBuffer>
  /** Texels the triangles cover. */
  covered: number
  /** Covered texels whose center lies inside more than one triangle. */
  overlapping: number
}

export const EMPTY_TRIANGLE = 0xffffffff
export const COVERED = 1
export const PADDED = 2

/** Sample points in a texel, in priority order: the center, then four quarter offsets. */
const SAMPLES = [
  [0.5, 0.5],
  [0.25, 0.25],
  [0.75, 0.25],
  [0.25, 0.75],
  [0.75, 0.75]
] as const
const NONE = 255
/** Relative tolerance for "strictly inside" (keeps shared edges from counting as overlap). */
const STRICT = 1e-5

const wrap = (i: number, n: number): number => ((i % n) + n) % n

export function rasterizeUv(input: GBufferInput, width: number, height: number, padding = 0): GBuffer {
  const { positions, normals, uv, indices, leafIndex } = input
  const texels = width * height
  const position = new Float32Array(texels * 4)
  const positionBits = new Uint32Array(position.buffer)
  const normal = new Float32Array(texels * 4)
  for (let i = 0; i < texels; i++) positionBits[i * 4 + 3] = EMPTY_TRIANGLE
  const priority = new Uint8Array(texels).fill(NONE)
  const centerHits = new Uint8Array(texels)

  const write = (idx: number, t: number, w0: number, w1: number, w2: number, a: number, b: number, c: number): void => {
    for (let k = 0; k < 3; k++) {
      position[idx * 4 + k] = positions[a * 3 + k]! * w0 + positions[b * 3 + k]! * w1 + positions[c * 3 + k]! * w2
    }
    const nx = normals[a * 3]! * w0 + normals[b * 3]! * w1 + normals[c * 3]! * w2
    const ny = normals[a * 3 + 1]! * w0 + normals[b * 3 + 1]! * w1 + normals[c * 3 + 1]! * w2
    const nz = normals[a * 3 + 2]! * w0 + normals[b * 3 + 2]! * w1 + normals[c * 3 + 2]! * w2
    const len = Math.hypot(nx, ny, nz) || 1
    normal[idx * 4] = nx / len
    normal[idx * 4 + 1] = ny / len
    normal[idx * 4 + 2] = nz / len
    normal[idx * 4 + 3] = COVERED
    positionBits[idx * 4 + 3] = leafIndex[t]!
  }

  for (let t = input.first; t < input.first + input.count; t++) {
    const a = indices[t * 3]!
    const b = indices[t * 3 + 1]!
    const c = indices[t * 3 + 2]!
    const ax = uv[a * 2]! * width
    const ay = uv[a * 2 + 1]! * height
    const bx = uv[b * 2]! * width
    const by = uv[b * 2 + 1]! * height
    const cx = uv[c * 2]! * width
    const cy = uv[c * 2 + 1]! * height
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    if (!Number.isFinite(area) || Math.abs(area) < 1e-12) continue
    const x0 = Math.floor(Math.min(ax, bx, cx))
    const x1 = Math.ceil(Math.max(ax, bx, cx))
    const y0 = Math.floor(Math.min(ay, by, cy))
    const y1 = Math.ceil(Math.max(ay, by, cy))
    // Triangles spanning many texture repeats (broken or tiling UVs) aren't worth drawing.
    if ((x1 - x0) * (y1 - y0) > 4 * texels) continue
    const inv = 1 / area
    for (let py = y0; py < y1; py++) {
      const ty = wrap(py, height)
      for (let px = x0; px < x1; px++) {
        const idx = ty * width + wrap(px, width)
        for (let s = 0; s < SAMPLES.length; s++) {
          // Past the center, only samples better than what the texel has matter.
          if (s > 0 && s >= priority[idx]!) break
          const sx = px + SAMPLES[s]![0]
          const sy = py + SAMPLES[s]![1]
          const w0 = ((cx - bx) * (sy - by) - (cy - by) * (sx - bx)) * inv
          const w1 = ((ax - cx) * (sy - cy) - (ay - cy) * (sx - cx)) * inv
          const w2 = 1 - w0 - w1
          if (w0 < -1e-7 || w1 < -1e-7 || w2 < -1e-7) continue
          if (s === 0 && w0 > STRICT && w1 > STRICT && w2 > STRICT && centerHits[idx]! < 2) centerHits[idx]!++
          if (s < priority[idx]!) {
            priority[idx] = s
            write(idx, t, w0, w1, w2, a, b, c)
          }
          break
        }
      }
    }
  }

  let covered = 0
  let overlapping = 0
  const frontier: number[] = []
  for (let i = 0; i < texels; i++) {
    if (priority[i] === NONE) continue
    covered++
    if (centerHits[i]! > 1) overlapping++
    frontier.push(i)
  }

  // Edge padding: grow the islands one ring at a time, copying the neighbor's surface point.
  let ring = frontier
  for (let step = 0; step < padding && ring.length; step++) {
    const next: number[] = []
    for (const i of ring) {
      const x = i % width
      const y = (i - x) / width
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= width) continue
          const j = ny * width + nx
          if (normal[j * 4 + 3]) continue
          position.copyWithin(j * 4, i * 4, i * 4 + 4)
          normal.copyWithin(j * 4, i * 4, i * 4 + 3)
          normal[j * 4 + 3] = PADDED
          next.push(j)
        }
      }
    }
    ring = next
  }

  return { width, height, position, normal, covered, overlapping }
}
