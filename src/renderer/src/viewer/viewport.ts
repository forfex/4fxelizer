// Pure 2D viewport math. All values are in device pixels, so integer zoom levels map
// image pixels onto whole screen pixels (crisp at any OS display scaling).

export interface Size {
  width: number
  height: number
}

export interface View {
  /** Device pixels per image pixel. */
  zoom: number
  /** Device-pixel position of the image's top-left corner inside the canvas. */
  x: number
  y: number
}

export const ZOOM_LEVELS = [
  1 / 16, 1 / 12, 1 / 8, 1 / 6, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 48, 64
]

export const MIN_ZOOM = ZOOM_LEVELS[0]!
export const MAX_ZOOM = ZOOM_LEVELS[ZOOM_LEVELS.length - 1]!

/** Next preset level above (dir = 1) or below (dir = -1) the current zoom. */
export function stepZoom(zoom: number, dir: 1 | -1): number {
  const eps = 1e-6
  if (dir > 0) return ZOOM_LEVELS.find((z) => z > zoom + eps) ?? MAX_ZOOM
  return [...ZOOM_LEVELS].reverse().find((z) => z < zoom - eps) ?? MIN_ZOOM
}

/**
 * Keeps the image aligned to whole device pixels. At integer zoom that makes
 * every image-pixel edge land exactly on a screen-pixel edge.
 */
function snap(view: View): View {
  return { zoom: view.zoom, x: Math.round(view.x), y: Math.round(view.y) }
}

export function centered(image: Size, canvas: Size, zoom: number): View {
  return snap({
    zoom,
    x: (canvas.width - image.width * zoom) / 2,
    y: (canvas.height - image.height * zoom) / 2
  })
}

/**
 * Largest preset zoom that fits the image inside the canvas (with padding).
 * Prefers integer zoom when magnifying so pixel art stays crisp.
 */
export function fitView(image: Size, canvas: Size, padding = 24): View {
  const available = Math.min(
    (canvas.width - padding * 2) / image.width,
    (canvas.height - padding * 2) / image.height
  )
  const zoom = [...ZOOM_LEVELS].reverse().find((z) => z <= available) ?? MIN_ZOOM
  return centered(image, canvas, zoom)
}

/** Zooms so the image point under `anchor` (device px in canvas) stays under it. */
export function zoomAt(view: View, zoom: number, anchor: { x: number; y: number }): View {
  const clamped = Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM)
  const ix = (anchor.x - view.x) / view.zoom
  const iy = (anchor.y - view.y) / view.zoom
  return snap({ zoom: clamped, x: anchor.x - ix * clamped, y: anchor.y - iy * clamped })
}

export function pan(view: View, dx: number, dy: number): View {
  return snap({ zoom: view.zoom, x: view.x + dx, y: view.y + dy })
}

/** Canvas device-pixel position → image pixel coordinate (floored), or null when outside. */
export function pixelAt(view: View, image: Size, point: { x: number; y: number }): { x: number; y: number } | null {
  const x = Math.floor((point.x - view.x) / view.zoom)
  const y = Math.floor((point.y - view.y) / view.zoom)
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return null
  return { x, y }
}

/**
 * Canvas device-pixel x of the before/after divider. The divider is anchored to the image
 * (`pos` is a fraction of the image width, snapped to a pixel column), so it moves with pans and zooms.
 */
export function splitScreenX(view: View, image: Size, pos: number): number {
  return Math.round(view.x + Math.round(pos * image.width) * view.zoom)
}

/** Divider position (fraction of the image width, 0–1) under canvas device-pixel x. */
export function splitPosAt(view: View, image: Size, x: number): number {
  return Math.min(Math.max((x - view.x) / (image.width * view.zoom), 0), 1)
}

/** True when the divider lies inside the canvas, so it can be seen and grabbed. */
export function splitVisible(view: View, image: Size, canvas: Size, pos: number): boolean {
  const x = splitScreenX(view, image, pos)
  return x > 0 && x < canvas.width
}

/** Divider position at the middle of the visible part of the image. */
export function splitAtVisibleCenter(view: View, image: Size, canvas: Size): number {
  const left = Math.max(view.x, 0)
  const right = Math.min(view.x + image.width * view.zoom, canvas.width)
  return right > left ? splitPosAt(view, image, (left + right) / 2) : 0.5
}
