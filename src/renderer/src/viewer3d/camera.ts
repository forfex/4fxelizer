// Orbit camera for the 3D view, and the few matrix helpers it needs. Matrices are column-major
// Float32Arrays, as WGSL's mat4x4f expects; clip space is WebGPU's (z from 0 to 1).

export type Vec3 = [number, number, number]
export type Mat4 = Float32Array

export interface OrbitCamera {
  /** Point orbited around. */
  target: Vec3
  /** Rotation around the vertical axis, radians (0 = looking down -z, from +z). */
  yaw: number
  /** Elevation, radians (positive = looking down on the model). */
  pitch: number
  distance: number
}

/** Vertical field of view, radians. */
export const FOV = (50 * Math.PI) / 180
const MAX_PITCH = Math.PI / 2 - 0.01

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export function normalize(a: Vec3): Vec3 {
  const l = Math.hypot(...a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

/** Camera position in world space. */
export function eye(c: OrbitCamera): Vec3 {
  const cp = Math.cos(c.pitch)
  return [
    c.target[0] + c.distance * cp * Math.sin(c.yaw),
    c.target[1] + c.distance * Math.sin(c.pitch),
    c.target[2] + c.distance * cp * Math.cos(c.yaw)
  ]
}

/** Right, up and forward (towards the target) directions of the camera. */
export function basis(c: OrbitCamera): { right: Vec3; up: Vec3; forward: Vec3 } {
  const forward = normalize(sub(c.target, eye(c)))
  const right = normalize(cross(forward, [0, 1, 0]))
  return { right, up: cross(right, forward), forward }
}

export function lookAt(from: Vec3, to: Vec3, upHint: Vec3 = [0, 1, 0]): Mat4 {
  const f = normalize(sub(to, from))
  const r = normalize(cross(f, upHint))
  const u = cross(r, f)
  // prettier-ignore
  return new Float32Array([
    r[0], u[0], -f[0], 0,
    r[1], u[1], -f[1], 0,
    r[2], u[2], -f[2], 0,
    -dot(r, from), -dot(u, from), dot(f, from), 1
  ])
}

/** Perspective projection to WebGPU clip space (depth 0 at `near`, 1 at `far`). */
export function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2)
  const nf = 1 / (near - far)
  // prettier-ignore
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, far * nf, -1,
    0, 0, near * far * nf, 0
  ])
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16)
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[k * 4 + row]! * b[col * 4 + k]!
      out[col * 4 + row] = s
    }
  }
  return out
}

/** Clip-space position of a world point (for tests and picking). */
export function transformPoint(m: Mat4, p: Vec3): [number, number, number, number] {
  const out: [number, number, number, number] = [0, 0, 0, 0]
  for (let row = 0; row < 4; row++) out[row] = m[row]! * p[0] + m[4 + row]! * p[1] + m[8 + row]! * p[2] + m[12 + row]!
  return out
}

/** View-projection matrix, with near/far planes fitted around a model of the given radius. */
export function viewProjection(c: OrbitCamera, aspect: number, radius: number): Mat4 {
  const near = Math.max(c.distance - radius * 2, c.distance * 0.01, radius * 0.001)
  const far = c.distance + radius * 2
  return multiply(perspective(FOV, aspect, near, far), lookAt(eye(c), c.target))
}

/** A camera that shows the whole bounding box, seen slightly from above and in front. */
export function frameBounds(bounds: { min: Vec3; max: Vec3 }, aspect: number): OrbitCamera {
  const { min, max } = bounds
  const target: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  const radius = Math.max(Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2, 1e-6)
  // Fit the bounding sphere in the narrower of the two fields of view.
  const fov = Math.min(FOV, 2 * Math.atan(Math.tan(FOV / 2) * aspect))
  return { target, yaw: 0.5, pitch: 0.25, distance: (radius / Math.sin(fov / 2)) * 1.05 }
}

/** Orbits by a pointer drag of (dx, dy) CSS pixels. */
export function orbit(c: OrbitCamera, dx: number, dy: number): OrbitCamera {
  const pitch = Math.min(Math.max(c.pitch + dy * 0.008, -MAX_PITCH), MAX_PITCH)
  return { ...c, yaw: c.yaw - dx * 0.008, pitch }
}

/** Pans so the target follows a drag of (dx, dy) pixels in a view `height` pixels tall. */
export function panCamera(c: OrbitCamera, dx: number, dy: number, height: number): OrbitCamera {
  const { right, up } = basis(c)
  // World units per pixel at the target's depth.
  const scale = (2 * c.distance * Math.tan(FOV / 2)) / Math.max(height, 1)
  const t: Vec3 = [...c.target]
  for (let a = 0; a < 3; a++) t[a] = t[a]! - right[a]! * dx * scale + up[a]! * dy * scale
  return { ...c, target: t }
}

/** Zooms in (steps > 0) or out; each step moves 15% closer or farther. */
export function dolly(c: OrbitCamera, steps: number, minDistance: number): OrbitCamera {
  return { ...c, distance: Math.max(c.distance * Math.pow(0.85, steps), minDistance) }
}
