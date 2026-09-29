import { useEffect, useRef, useState, type RefObject } from 'react'
import { savedSettings } from '@/settings'

/** Accumulated wheel delta per notch (a mouse notch is ~100; touchpads send small deltas). */
const WHEEL_NOTCH = 100

/**
 * Mouse-wheel input for a value control (slider, dropdown). Calls `onNotches` with whole wheel
 * notches (positive = wheel up) and whether Shift was held, but only once the control is armed;
 * until then the wheel scrolls the panel. Returns whether it's armed, for the UI hint.
 *
 * When a control arms is the user's choice (Settings › Input, `UserSettings.wheel`): by default
 * after the pointer has rested on it without scrolling (or right after it was pressed), so
 * scrolling a panel past controls never changes them; or only once pressed, right away, or never.
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
    // Read on every event, so a change in Settings applies to controls already on screen.
    const wheel = () => savedSettings().wheel
    const arm = (on: boolean): void => {
      window.clearTimeout(timer)
      isArmed = on && wheel().mode !== 'off'
      setArmed(isArmed)
    }
    const armLater = (): void => {
      window.clearTimeout(timer)
      const { mode, delay } = wheel()
      if (mode === 'always') arm(true)
      else if (mode === 'hover') timer = window.setTimeout(() => arm(true), delay)
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
        if (!isArmed) return
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
