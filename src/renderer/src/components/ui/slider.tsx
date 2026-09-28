import { Slider as SliderPrimitive } from 'radix-ui'
import { useEffect, useRef, useState, type ComponentProps } from 'react'
import { wheelValue } from '@/lib/sliderMath'
import { cn } from '@/lib/utils'

export interface SliderProps extends ComponentProps<typeof SliderPrimitive.Root> {
  /** Number of tick marks drawn under the track (0 = none). */
  ticks?: number
  /**
   * Mouse-wheel handler (positive notches = wheel up). Defaults to one step per notch
   * via onValueChange; Shift moves ten times as far.
   */
  onWheelNotches?(notches: number, coarse: boolean): void
}

/** Accumulated wheel delta per notch (a mouse notch is ~100; touchpads send small deltas). */
const WHEEL_NOTCH = 100
/**
 * The wheel only adjusts a slider after the pointer has rested on it this long without scrolling
 * (or right after it was clicked/dragged), so scrolling a panel past sliders never changes them.
 */
const ARM_DELAY_MS = 1000

export function Slider({ className, ticks = 0, onWheelNotches, ...props }: SliderProps) {
  const rootRef = useRef<HTMLSpanElement>(null)
  const latest = useRef({ props, onWheelNotches })
  latest.current = { props, onWheelNotches }
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    const el = rootRef.current
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
      const { props: p, onWheelNotches: custom } = latest.current
      if (!isArmed) {
        // Scrolling past: let the panel scroll, and only arm once the pointer rests here.
        armLater()
        return
      }
      if (p.disabled || !p.value?.length) return
      e.preventDefault()
      // Shift+wheel arrives as horizontal scroll on Windows/Linux.
      const delta = e.deltaY || e.deltaX
      accumulated += e.deltaMode === WheelEvent.DOM_DELTA_LINE ? delta * 33 : delta
      const notches = Math.trunc(accumulated / WHEEL_NOTCH)
      if (notches === 0) return
      accumulated -= notches * WHEEL_NOTCH
      if (custom) return custom(-notches, e.shiftKey)
      const next = wheelValue(p.value[0]!, -notches, p.min ?? 0, p.max ?? 100, p.step ?? 1, e.shiftKey)
      if (next !== p.value[0]) p.onValueChange?.([next])
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
  }, [])

  const wheelReady = armed && !props.disabled
  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      <SliderPrimitive.Root
        ref={rootRef}
        data-wheel={wheelReady ? 'armed' : undefined}
        title={wheelReady ? 'Mouse wheel adjusts this value (Shift = faster)' : undefined}
        className="group relative flex h-5 w-full touch-none items-center select-none"
        {...props}
      >
        <SliderPrimitive.Track className="bevel-sunken relative h-1.5 w-full grow bg-well">
          <SliderPrimitive.Range className="absolute h-full bg-accent/60 group-data-[wheel=armed]:bg-accent/85" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          className={cn(
            'bevel-raised block h-4 w-2.5 bg-panel-hi hover:brightness-110',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
            'group-data-[wheel=armed]:outline-px group-data-[wheel=armed]:outline-offset-1 group-data-[wheel=armed]:outline-accent'
          )}
        />
      </SliderPrimitive.Root>
      {ticks > 1 && (
        <div className="flex justify-between px-[5px]" aria-hidden>
          {Array.from({ length: ticks }, (_, i) => (
            <span key={i} className="h-1 w-(--px) bg-dim/50" />
          ))}
        </div>
      )}
    </div>
  )
}
