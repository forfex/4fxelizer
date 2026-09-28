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
        <SliderPrimitive.Track
          className={cn(
            'bevel-sunken relative h-2 w-full grow overflow-hidden rounded-fx border-px border-edge bg-well',
            'group-data-[wheel=armed]:outline-2 group-data-[wheel=armed]:outline-offset-1 group-data-[wheel=armed]:outline-magenta group-data-[wheel=armed]:outline-solid'
          )}
        >
          {/* 50% dither fill: the brand's stand-in for a gradient. */}
          <SliderPrimitive.Range className="absolute h-full dither-50 [--dither-a:var(--fx-accent)] [--dither-b:var(--fx-accent-soft)]" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          className={cn(
            'bevel-raised relative block h-4.5 w-2.5 rounded-[2px] border-px border-edge bg-panel-hi hover:bg-hover',
            'after:absolute after:inset-x-0.5 after:top-1/2 after:h-0.5 after:-translate-y-1/2 after:bg-accent',
            'focus-visible:ring-focus'
          )}
        />
      </SliderPrimitive.Root>
      {ticks > 1 && (
        <div className="flex justify-between px-[5px]" aria-hidden>
          {Array.from({ length: ticks }, (_, i) => (
            <span key={i} className="h-1 w-(--px) bg-line" />
          ))}
        </div>
      )}
    </div>
  )
}
