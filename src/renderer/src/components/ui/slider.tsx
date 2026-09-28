import { Slider as SliderPrimitive } from 'radix-ui'
import { useEffect, useRef, type ComponentProps } from 'react'
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
const WHEEL_NOTCH = 50

export function Slider({ className, ticks = 0, onWheelNotches, ...props }: SliderProps) {
  const rootRef = useRef<HTMLSpanElement>(null)
  const latest = useRef({ props, onWheelNotches })
  latest.current = { props, onWheelNotches }

  // Needs a non-passive listener so the panel doesn't scroll while the wheel adjusts the value.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    let accumulated = 0
    const onWheel = (e: WheelEvent): void => {
      const { props: p, onWheelNotches: custom } = latest.current
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
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      <SliderPrimitive.Root ref={rootRef} className="relative flex h-5 w-full touch-none items-center select-none" {...props}>
        <SliderPrimitive.Track className="bevel-sunken relative h-1.5 w-full grow bg-well">
          <SliderPrimitive.Range className="absolute h-full bg-accent/60" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          className="bevel-raised block h-4 w-2.5 bg-panel-hi hover:brightness-110 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
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
