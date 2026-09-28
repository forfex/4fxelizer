import { DropdownMenu } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

// Menus float: a 2px ink outline, a raised bevel and the hard offset shadow of a window.
// Items never wrap; a 22px left gutter holds the selected mark, so every label lines up.

/** Shared by dropdown menus, select lists and the title bar's menu bar. */
export const MENU_CONTENT_CLASS = cn(
  'z-50 min-w-48 rounded-fx-md border-2 border-edge bg-panel p-1',
  'shadow-[inset_var(--px)_var(--px)_0_var(--fx-bevel-light),inset_calc(-1*var(--px))_calc(-1*var(--px))_0_var(--fx-bevel-dark),var(--fx-shadow-window)]'
)
export const MENU_ITEM_CLASS = cn(
  'relative flex min-h-7 cursor-default items-center gap-4 rounded-[2px] pr-3 pl-5.5 whitespace-nowrap text-text outline-none select-none',
  'data-highlighted:bg-accent-soft data-disabled:text-faint'
)
export const MENU_LABEL_CLASS = 'pt-2.5 pr-3 pb-1 pl-5.5 text-dim label-caps first:pt-1.5'
export const MENU_SEPARATOR_CLASS = 'mx-2 my-1 h-(--px) bg-line'
/** The selected mark in an item's gutter (a small accent square). */
export const MENU_MARK_CLASS = 'absolute top-1/2 left-2 size-1.5 -translate-y-1/2 rounded-[1px] bg-accent'

export const Menu = DropdownMenu.Root
export const MenuTrigger = DropdownMenu.Trigger

export function MenuContent({ className, ...props }: ComponentProps<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content sideOffset={2} align="start" className={cn(MENU_CONTENT_CLASS, className)} {...props} />
    </DropdownMenu.Portal>
  )
}

export function MenuItem({ className, ...props }: ComponentProps<typeof DropdownMenu.Item>) {
  return <DropdownMenu.Item className={cn(MENU_ITEM_CLASS, className)} {...props} />
}

export function MenuLabel({ className, ...props }: ComponentProps<typeof DropdownMenu.Label>) {
  return <DropdownMenu.Label className={cn(MENU_LABEL_CLASS, className)} {...props} />
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className={MENU_SEPARATOR_CLASS} />
}

export const MenuSub = DropdownMenu.Sub

export function MenuSubTrigger({ className, children, ...props }: ComponentProps<typeof DropdownMenu.SubTrigger>) {
  return (
    <DropdownMenu.SubTrigger className={cn(MENU_ITEM_CLASS, 'data-[state=open]:bg-accent-soft', className)} {...props}>
      {children}
      <span className="ml-auto text-small text-dim">▸</span>
    </DropdownMenu.SubTrigger>
  )
}

export function MenuSubContent({ className, ...props }: ComponentProps<typeof DropdownMenu.SubContent>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.SubContent sideOffset={2} className={cn(MENU_CONTENT_CLASS, 'max-h-96 overflow-y-auto', className)} {...props} />
    </DropdownMenu.Portal>
  )
}
