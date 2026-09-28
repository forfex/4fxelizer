// Pure slider math: snapping, mouse-wheel stepping and logarithmic mapping.

export const clamp = (v: number, min: number, max: number): number => Math.min(Math.max(v, min), max)

export function decimalsOf(step: number): number {
  const s = String(step)
  return s.includes('.') ? s.length - s.indexOf('.') - 1 : 0
}

/** Rounds to the step grid (anchored at `min`), clamps, and removes float noise (0.30000000004). */
export function snapToStep(v: number, min: number, max: number, step: number): number {
  const snapped = Math.round((v - min) / step) * step + min
  return Number(clamp(snapped, min, max).toFixed(decimalsOf(step)))
}

/**
 * Value after `notches` wheel notches (positive = up = larger). One notch is one step, or 1% of the
 * range on sliders with more than 200 steps; `coarse` (Shift) moves ten times as far.
 */
export function wheelValue(value: number, notches: number, min: number, max: number, step: number, coarse = false): number {
  const steps = (max - min) / step
  const perNotch = steps > 200 ? Math.max(step, Math.round(steps / 100) * step) : step
  return snapToStep(value + notches * perNotch * (coarse ? 10 : 1), min, max, step)
}

/** Log-scale sliders run over positions 0..LOG_POSITIONS. */
export const LOG_POSITIONS = 1000

export function logToPosition(value: number, min: number, max: number): number {
  return (Math.log(clamp(value, min, max) / min) / Math.log(max / min)) * LOG_POSITIONS
}

export function positionToLog(position: number, min: number, max: number, step: number): number {
  return snapToStep(min * (max / min) ** (position / LOG_POSITIONS), min, max, step)
}

/** Wheel on a log slider: about ±10% per notch (±2× with `coarse`), always at least one step. */
export function wheelLogValue(value: number, notches: number, min: number, max: number, step: number, coarse = false): number {
  let v = value
  const factor = coarse ? 2 : 1.1
  for (let i = 0; i < Math.abs(notches); i++) {
    v = notches > 0 ? Math.max(v + step, v * factor) : Math.min(v - step, v / factor)
  }
  return snapToStep(v, min, max, step)
}
