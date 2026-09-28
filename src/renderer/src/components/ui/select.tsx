import { Select as SelectPrimitive } from 'radix-ui'
import { cn } from '@/lib/utils'

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

/** Dropdown select: a sunken field with a beveled drop button, options in a raised panel. */
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
  return (
    <SelectPrimitive.Root value={value ?? ''} onValueChange={(v) => onValueChange(v as T)} disabled={disabled}>
      <SelectPrimitive.Trigger
        title={title}
        className={cn(
          'bevel-sunken flex h-6 min-w-0 items-center justify-between gap-1 rounded-fx bg-well pr-0.5 pl-1.5 text-left',
          'disabled:opacity-45 data-placeholder:text-dim',
          className
        )}
      >
        <span className="truncate">
          <SelectPrimitive.Value placeholder={placeholder ?? 'Choose…'} />
        </span>
        <SelectPrimitive.Icon className="bevel-raised flex h-5 w-4 shrink-0 items-center justify-center bg-panel-hi text-small leading-none text-dim">
          ▼
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={2}
          className="bevel-raised z-50 max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden rounded-fx border-px border-edge bg-panel"
        >
          <SelectPrimitive.Viewport className="p-0.5">
            {groupOptions(options).map((g, i) => (
              <SelectPrimitive.Group key={g.group ?? i}>
                {g.group && (
                  <SelectPrimitive.Label className="px-2 pt-1 pb-0.5 text-small font-semibold tracking-wide text-dim uppercase">
                    {g.group}
                  </SelectPrimitive.Label>
                )}
                {g.items.map((o) => (
                  <SelectPrimitive.Item
                    key={o.value}
                    value={o.value}
                    title={o.hint}
                    className={cn(
                      'flex h-6 cursor-default items-center rounded-fx px-2 outline-none select-none',
                      'data-highlighted:bg-accent data-highlighted:text-accent-text data-[state=checked]:font-semibold'
                    )}
                  >
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
