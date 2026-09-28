// Small retro building blocks: chiseled group boxes, LCD readouts, LED indicators.

import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Chiseled frame with its title set into the border (classic group box). */
export function GroupBox({ title, className, children, ...props }: ComponentProps<'fieldset'> & { title: ReactNode }) {
  return (
    <fieldset
      className={cn(
        'min-w-0 rounded-fx border-px border-bevel-dark px-2.5 pt-1 pb-2.5',
        'shadow-[inset_var(--px)_var(--px)_0_var(--fx-bevel-light),var(--px)_var(--px)_0_var(--fx-bevel-light)]',
        className
      )}
      {...props}
    >
      <legend className="px-1 text-small font-semibold tracking-wide text-dim uppercase">{title}</legend>
      {children}
    </fieldset>
  )
}

/** Monospace value readout in an inset LCD box. */
export function Lcd({ className, ...props }: ComponentProps<'output'>) {
  return (
    <output
      className={cn(
        'bevel-sunken inline-flex h-6 min-w-12 items-center justify-end rounded-fx bg-lcd px-1.5',
        'font-mono text-ui text-lcd-text tabular-nums',
        className
      )}
      {...props}
    />
  )
}

export type LedState = 'on' | 'warn' | 'error' | 'off'

const ledColor: Record<LedState, string> = {
  on: 'bg-led-on shadow-[0_0_4px_var(--fx-led-green)]',
  warn: 'bg-led-warn shadow-[0_0_4px_var(--fx-led-amber)]',
  error: 'bg-led-error shadow-[0_0_4px_var(--fx-led-red)]',
  off: 'bg-led-off'
}

export function Led({ state, className }: { state: LedState; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', ledColor[state], className)} />
}

/** On/off switch shown as a beveled button with a status LED. */
export function LedToggle({
  checked,
  onCheckedChange,
  label,
  className
}: {
  checked: boolean
  onCheckedChange(checked: boolean): void
  label: string
  className?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={checked ? `${label}: on` : `${label}: off`}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'bevel-raised inline-flex size-5 items-center justify-center rounded-fx bg-panel-hi',
        'active:bevel-sunken',
        className
      )}
    >
      <Led state={checked ? 'on' : 'off'} />
    </button>
  )
}
