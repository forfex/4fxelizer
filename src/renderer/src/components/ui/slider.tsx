import { Slider as SliderPrimitive } from 'radix-ui'
import { useRef, type ComponentProps } from 'react'
import { wheelValue } from '@/lib/sliderMath'
import { cn } from '@/lib/utils'
import { useWheelArming } from '@/lib/useWheelArming'

export interface SliderProps extends ComponentProps<typeof SliderPrimitive.Root> {
  /** Number of tick marks drawn under the track (0 = none). */
  ticks?: number
  /**
   * Mouse-wheel handler (positive notches = wheel up). Defaults to one step per notch
   * via onValueChange; Shift moves ten times as far.
   */
  onWheelNotches?(notches: number, coarse: boolean): void
}

export function Slider({ className, ticks = 0, onWheelNotches, ...props }: SliderProps) {
  const rootRef = useRef<HTMLSpanElement>(null)
  const wheelReady = useWheelArming(
    rootRef,
    (notches, coarse) => {
      if (!props.value?.length) return
      if (onWheelNotches) return onWheelNotches(notches, coarse)
      const next = wheelValue(props.value[0]!, notches, props.min ?? 0, props.max ?? 100, props.step ?? 1, coarse)
      if (next !== props.value[0]) props.onValueChange?.([next])
    },
    !props.disabled
  )
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
