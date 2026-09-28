import { Select as SelectPrimitive } from 'radix-ui'
import { useRef } from 'react'
import { cn } from '@/lib/utils'
import { useWheelArming } from '@/lib/useWheelArming'
import { MENU_CONTENT_CLASS, MENU_ITEM_CLASS, MENU_LABEL_CLASS, MENU_MARK_CLASS } from './menu'

export interface SelectOption<T extends string> {
  value: T
  label: string
  hint?: string
  /** Options with the same group are listed together under that heading. */
  group?: string
}

/** Consecutive options sharing a group, in order. */
function groupOptions<T extends string>(options: readonly SelectOption<T>[]): { group?: string; items: SelectOption<T>[] }[] {
  const groups: { group?: string; items: SelectOption<T>[] }[] = []
  for (const o of options) {
    const last = groups[groups.length - 1]
    if (last && last.group === o.group) last.items.push(o)
    else groups.push({ group: o.group, items: [o] })
  }
  return groups
}

/**
 * Dropdown select: a beveled trigger with a caret cell, options in a floating menu panel.
 * Like sliders, the mouse wheel steps through the options once the field is armed (see useWheelArming).
 */
export function Select<T extends string>({
  value,
  onValueChange,
  options,
  className,
  disabled,
  title,
  placeholder
}: {
  value: T | null
  onValueChange(value: T): void
  options: readonly SelectOption<T>[]
  className?: string
  disabled?: boolean
  title?: string
  placeholder?: string
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const wheelReady = useWheelArming(
    triggerRef,
    (notches) => {
      const i = options.findIndex((o) => o.value === value)
      // Wheel down (negative notches) moves to the next option; stop at the ends.
      const next = options[Math.min(Math.max(i < 0 ? 0 : i - notches, 0), options.length - 1)]
      if (next && next.value !== value) onValueChange(next.value)
    },
    !disabled && options.length > 1
  )
  return (
    <SelectPrimitive.Root value={value ?? ''} onValueChange={(v) => onValueChange(v as T)} disabled={disabled}>
      <SelectPrimitive.Trigger
        ref={triggerRef}
        title={wheelReady ? `${title ? `${title}
` : ''}Mouse wheel changes this option` : title}
        data-wheel={wheelReady ? 'armed' : undefined}
        className={cn(
          'bevel-raised flex h-control min-w-0 items-center justify-between gap-1 rounded-fx border-px border-edge bg-panel-hi pl-2 text-left',
          'hover:bg-hover disabled:opacity-45 data-placeholder:text-dim data-[state=open]:bg-well data-[state=open]:bevel-sunken',
          'data-[wheel=armed]:outline-2 data-[wheel=armed]:outline-offset-1 data-[wheel=armed]:outline-magenta data-[wheel=armed]:outline-solid',
          className
        )}
      >
        <span className="truncate">
          <SelectPrimitive.Value placeholder={placeholder ?? 'Choose…'} />
        </span>
        {/* Caret cell, split off by an ink line. */}
        <SelectPrimitive.Icon className="flex w-5 shrink-0 items-center justify-center self-stretch rounded-r-fx border-l-px border-edge bg-panel">
          <span className="mt-1 size-0 border-4 border-transparent border-t-[5px] border-t-text" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={2}
          className={cn(
            MENU_CONTENT_CLASS,
            'max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden p-0'
          )}
        >
          <SelectPrimitive.Viewport className="p-1">
            {groupOptions(options).map((g, i) => (
              <SelectPrimitive.Group key={g.group ?? i}>
                {g.group && <SelectPrimitive.Label className={MENU_LABEL_CLASS}>{g.group}</SelectPrimitive.Label>}
                {g.items.map((o) => (
                  <SelectPrimitive.Item key={o.value} value={o.value} title={o.hint} className={MENU_ITEM_CLASS}>
                    <SelectPrimitive.ItemIndicator className={MENU_MARK_CLASS} />
                    <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                  </SelectPrimitive.Item>
                ))}
              </SelectPrimitive.Group>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}
