import { Slider as SliderPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export interface SliderProps extends ComponentProps<typeof SliderPrimitive.Root> {
  /** Number of tick marks drawn under the track (0 = none). */
  ticks?: number
}

export function Slider({ className, ticks = 0, ...props }: SliderProps) {
  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      <SliderPrimitive.Root className="relative flex h-5 w-full touch-none items-center select-none" {...props}>
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
