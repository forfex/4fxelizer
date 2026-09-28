import { Dialog as DialogPrimitive } from 'radix-ui'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export const Dialog = DialogPrimitive.Root
export const DialogClose = DialogPrimitive.Close

export function DialogContent({
  title,
  className,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { title: ReactNode }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/50" />
      <DialogPrimitive.Content
        className={cn(
          'bevel-raised fixed top-1/2 left-1/2 z-40 flex max-h-[85vh] w-[min(720px,90vw)] -translate-x-1/2 -translate-y-1/2 flex-col',
          'rounded-fx border-px border-edge bg-panel',
          className
        )}
        {...props}
      >
        <div className="flex h-7 items-center justify-between border-b-px border-edge bg-panel-hi px-2">
          <DialogPrimitive.Title className="text-ui font-semibold">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Close
            aria-label="Close"
            className="bevel-raised flex size-5 items-center justify-center rounded-fx bg-panel-hi text-dim active:bevel-sunken"
          >
            ×
          </DialogPrimitive.Close>
        </div>
        <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
        <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}
