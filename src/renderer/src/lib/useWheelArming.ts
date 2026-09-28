import { useEffect, useRef, useState, type RefObject } from 'react'

/** Accumulated wheel delta per notch (a mouse notch is ~100; touchpads send small deltas). */
const WHEEL_NOTCH = 100
/**
 * The wheel only adjusts a control after the pointer has rested on it this long without scrolling
 * (or right after it was pressed), so scrolling a panel past controls never changes them.
 */
const ARM_DELAY_MS = 1000

/**
 * Mouse-wheel input for a value control (slider, dropdown). Calls `onNotches` with whole wheel
 * notches (positive = wheel up) and whether Shift was held, but only once the control is armed;
 * until then the wheel scrolls the panel. Returns whether it's armed, for the UI hint.
 */
export function useWheelArming(
  ref: RefObject<HTMLElement | null>,
  onNotches: (notches: number, coarse: boolean) => void,
  enabled = true
): boolean {
  const latest = useRef({ onNotches, enabled })
  latest.current = { onNotches, enabled }
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let accumulated = 0
    let isArmed = false
    let timer = 0
    const arm = (on: boolean): void => {
      window.clearTimeout(timer)
      isArmed = on
      setArmed(on)
    }
    const armLater = (): void => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => arm(true), ARM_DELAY_MS)
    }
    const onEnter = (): void => armLater()
    const onLeave = (): void => {
      accumulated = 0
      arm(false)
    }
    const onDown = (): void => arm(true)

    // Needs a non-passive listener so the panel doesn't scroll while the wheel adjusts the value.
    const onWheel = (e: WheelEvent): void => {
      if (!isArmed) {
        // Scrolling past: let the panel scroll, and only arm once the pointer rests here.
        armLater()
        return
      }
      if (!latest.current.enabled) return
      e.preventDefault()
      // Shift+wheel arrives as horizontal scroll on Windows/Linux.
      const delta = e.deltaY || e.deltaX
      accumulated += e.deltaMode === WheelEvent.DOM_DELTA_LINE ? delta * 33 : delta
      const notches = Math.trunc(accumulated / WHEEL_NOTCH)
      if (notches === 0) return
      accumulated -= notches * WHEEL_NOTCH
      latest.current.onNotches(-notches, e.shiftKey)
    }

    el.addEventListener('pointerenter', onEnter)
    el.addEventListener('pointerleave', onLeave)
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.clearTimeout(timer)
      el.removeEventListener('pointerenter', onEnter)
      el.removeEventListener('pointerleave', onLeave)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('wheel', onWheel)
    }
  }, [ref])

  return armed && enabled
}
