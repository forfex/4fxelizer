import { Dialog as DialogPrimitive } from 'radix-ui'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { CloseIcon, DitherRamp } from './retro'

export const Dialog = DialogPrimitive.Root
export const DialogClose = DialogPrimitive.Close

/**
 * A floating window: 2px ink outline, the large soft corner and the hard offset shadow, with a
 * title strip whose dither ramp runs from the strip's ground into the accent.
 */
export function DialogContent({
  title,
  className,
  bodyClassName,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { title: ReactNode; bodyClassName?: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-bg/70" />
      <DialogPrimitive.Content
        className={cn(
          'fixed top-1/2 left-1/2 z-40 flex max-h-[85vh] w-[min(720px,90vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden',
          'rounded-fx-lg bg-panel window-frame',
          className
        )}
        {...props}
      >
        <div className="flex h-8 shrink-0 items-center gap-2 border-b-2 border-edge bg-panel-hi pr-1 pl-3 shadow-[inset_var(--px)_var(--px)_0_var(--fx-bevel-light)]">
          <DialogPrimitive.Title className="font-display text-[14px] leading-[18px] font-bold tracking-[0.02em] whitespace-nowrap">
            {title}
          </DialogPrimitive.Title>
          <DitherRamp className="h-2.5 flex-1" />
          <DialogPrimitive.Close
            aria-label="Close"
            className="bevel-raised flex size-6 items-center justify-center rounded-fx border-px border-edge bg-panel-hi text-text hover:bg-hover active:bg-well active:bevel-sunken"
          >
            <CloseIcon />
          </DialogPrimitive.Close>
        </div>
        <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
        <div className={cn('min-h-0 flex-1 overflow-auto p-4', bodyClassName)}>{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}
