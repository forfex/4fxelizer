// The screen color picker: main captures every display and covers each with an overlay window
// (src/renderer/picker.html) showing the capture, so colors can be picked from other applications
// and any monitor. Pure helpers shared by main and the overlay.

/** What a screen pick returns to the app window: the picked colors in order (empty = cancelled). */
export type ScreenPickResult = { colors: string[] } | { error: string }

/** One display's capture, sent to its overlay. `bgra` is width × height × 4 bytes, rows top down. */
export interface ScreenCapture {
  width: number
  height: number
  bgra: Uint8Array
  /** Colors picked so far (Shift+click keeps picking). */
  picked: number
}

/** The overlay's API (src/preload/picker.ts). */
export interface PickerApi {
  onCapture(listener: (capture: ScreenCapture) => void): void
  /** How many colors have been picked so far, on any display. */
  onPicked(listener: (count: number) => void): void
  /** The capture is drawn: main shows the overlays. */
  ready(): void
  /** Picks `hex`; `more` keeps the picker open for further picks. */
  pick(hex: string, more: boolean): void
  /** Closes the picker, keeping the colors picked so far. */
  done(): void
}

export const PICKER_IPC = {
  capture: 'picker:capture',
  picked: 'picker:picked',
  ready: 'picker:ready',
  pick: 'picker:pick',
  done: 'picker:done'
} as const

/** `#rrggbb` of the pixel at (x, y) in a BGRA capture (clamped to the image). */
export function captureHexAt(capture: Pick<ScreenCapture, 'width' | 'height' | 'bgra'>, x: number, y: number): string {
  const cx = Math.min(Math.max(Math.floor(x), 0), capture.width - 1)
  const cy = Math.min(Math.max(Math.floor(y), 0), capture.height - 1)
  const i = (cy * capture.width + cx) * 4
  const hex = (v: number): string => v.toString(16).padStart(2, '0')
  return `#${hex(capture.bgra[i + 2]!)}${hex(capture.bgra[i + 1]!)}${hex(capture.bgra[i]!)}`
}

/** Converts a BGRA capture to RGBA (opaque) for canvas ImageData. */
export function bgraToRgba(bgra: Uint8Array): Uint8ClampedArray<ArrayBuffer> {
  const rgba = new Uint8ClampedArray(bgra.length)
  for (let i = 0; i < bgra.length; i += 4) {
    rgba[i] = bgra[i + 2]!
    rgba[i + 1] = bgra[i + 1]!
    rgba[i + 2] = bgra[i]!
    rgba[i + 3] = 255
  }
  return rgba
}

/** A display's size in device pixels (what its capture should be). */
export function physicalSize(display: { size: { width: number; height: number }; scaleFactor: number }): { width: number; height: number } {
  return {
    width: Math.round(display.size.width * display.scaleFactor),
    height: Math.round(display.size.height * display.scaleFactor)
  }
}

/**
 * Which capture source shows which display: by display id, else (Linux, where sources may carry no
 * id) by position. Returns source indices per display (-1 = none).
 */
export function matchSources(displayIds: string[], sourceIds: string[]): number[] {
  const used = new Set<number>()
  const byId = displayIds.map((id) => {
    const i = sourceIds.indexOf(id)
    if (i >= 0) used.add(i)
    return i
  })
  return byId.map((i, d) => {
    if (i >= 0) return i
    const fallback = d < sourceIds.length && !used.has(d) && !sourceIds[d] ? d : -1
    if (fallback >= 0) used.add(fallback)
    return fallback
  })
}

export const isHexColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/.test(value)
