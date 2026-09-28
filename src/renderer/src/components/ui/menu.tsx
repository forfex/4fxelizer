import { DropdownMenu } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/** Shared by dropdown menus and the title bar's menu bar. */
export const MENU_CONTENT_CLASS = 'bevel-raised z-50 min-w-40 rounded-fx border-px border-edge bg-panel p-0.5'
export const MENU_ITEM_CLASS = cn(
  'flex h-6 cursor-default items-center gap-2 rounded-fx px-2 outline-none select-none',
  'data-highlighted:bg-accent data-highlighted:text-accent-text data-disabled:opacity-45'
)
export const MENU_SEPARATOR_CLASS = 'mx-1 my-0.5 h-(--px) bg-bevel-dark shadow-[0_var(--px)_0_var(--fx-bevel-light)]'

export const Menu = DropdownMenu.Root
export const MenuTrigger = DropdownMenu.Trigger

export function MenuContent({ className, ...props }: ComponentProps<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        sideOffset={2}
        align="start"
        className={cn(MENU_CONTENT_CLASS, className)}
        {...props}
      />
    </DropdownMenu.Portal>
  )
}

export function MenuItem({ className, ...props }: ComponentProps<typeof DropdownMenu.Item>) {
  return (
    <DropdownMenu.Item
      className={cn(MENU_ITEM_CLASS, className)}
      {...props}
    />
  )
}

export function MenuLabel({ className, ...props }: ComponentProps<typeof DropdownMenu.Label>) {
  return (
    <DropdownMenu.Label
      className={cn('px-2 pt-1 pb-0.5 text-small font-semibold tracking-wide text-dim uppercase', className)}
      {...props}
    />
  )
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className={MENU_SEPARATOR_CLASS} />
}

export const MenuSub = DropdownMenu.Sub

export function MenuSubTrigger({ className, children, ...props }: ComponentProps<typeof DropdownMenu.SubTrigger>) {
  return (
    <DropdownMenu.SubTrigger
      className={cn(
        'flex h-6 cursor-default items-center gap-2 rounded-fx px-2 outline-none select-none',
        'data-highlighted:bg-accent data-highlighted:text-accent-text data-[state=open]:bg-accent data-[state=open]:text-accent-text',
        className
      )}
      {...props}
    >
      {children}
      <span className="ml-auto text-small text-dim">▸</span>
    </DropdownMenu.SubTrigger>
  )
}

export function MenuSubContent({ className, ...props }: ComponentProps<typeof DropdownMenu.SubContent>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.SubContent
        sideOffset={2}
        className={cn('bevel-raised z-50 max-h-96 min-w-40 overflow-y-auto rounded-fx border-px border-edge bg-panel p-0.5', className)}
        {...props}
      />
    </DropdownMenu.Portal>
  )
}
