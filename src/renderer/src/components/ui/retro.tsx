// Small retro building blocks: chiseled group boxes, LCD readouts, LED indicators, the dither ramp.

import type { ComponentProps, CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Chiseled frame with its title set into the border (classic group box). */
export function GroupBox({ title, className, children, ...props }: ComponentProps<'fieldset'> & { title: ReactNode }) {
  return (
    <fieldset
      className={cn(
        'min-w-0 rounded-fx-md border-px border-bevel-dark px-3 pt-1 pb-3',
        'shadow-[inset_var(--px)_var(--px)_0_var(--fx-bevel-light),var(--px)_var(--px)_0_var(--fx-bevel-light)]',
        className
      )}
      {...props}
    >
      {/* The legend only interrupts the border, not the bevel shadow: its background hides the shadow behind the title. */}
      <legend className="-ml-0.5 bg-panel px-1.5 text-dim label-caps">{title}</legend>
      {children}
    </fieldset>
  )
}

/**
 * Scrollable content of a dockable panel (fills the panel, scrolls vertically). It is a size
 * container (`@container/panel`), so rows inside can reflow when the panel is narrow.
 */
export function PanelBody({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('@container/panel flex h-full min-h-0 flex-col gap-3 overflow-x-hidden overflow-y-auto bg-panel p-3', className)}
      {...props}
    />
  )
}

/** Classes of the sunken LCD well (readouts and numeric fields): phosphor digits with a faint glow. */
export const LCD_CLASS = cn(
  'bevel-sunken inline-flex h-control min-w-12 items-center rounded-fx border-px border-edge bg-lcd px-1.5',
  'font-mono text-lcd text-lcd-text tabular-nums',
  '[text-shadow:0_0_6px_color-mix(in_srgb,var(--fx-lcd-text)_55%,transparent)]'
)

/** Monospace value readout in an inset LCD box. */
export function Lcd({ className, ...props }: ComponentProps<'output'>) {
  return <output className={cn(LCD_CLASS, 'justify-end', className)} {...props} />
}

export type LedState = 'on' | 'warn' | 'error' | 'busy' | 'off'

const ledColor: Record<LedState, string> = {
  on: 'bg-led-on shadow-[0_0_6px_var(--fx-led-green)]',
  warn: 'bg-led-warn shadow-[0_0_6px_var(--fx-led-amber)]',
  error: 'bg-led-error shadow-[0_0_6px_var(--fx-led-red)]',
  busy: 'bg-magenta shadow-glow animate-pulse',
  off: 'bg-led-off shadow-[inset_0_0_0_var(--px)_var(--fx-edge)]'
}

/** 8px status light. Always beside a word: it is never the only signal. */
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
        'bevel-raised inline-flex size-5 shrink-0 items-center justify-center rounded-fx border-px border-edge bg-panel-hi',
        'hover:bg-hover active:bg-well active:bevel-sunken',
        className
      )}
    >
      <Led state={checked ? 'on' : 'off'} />
    </button>
  )
}

/**
 * Five-step ordered dither ramp (ground, 25%, 50%, 75%, solid): the brand's signature, used in
 * window title strips. `from` / `to` are CSS colors, normally var(--fx-…). Don't scatter it.
 */
export function DitherRamp({ from = 'var(--fx-panel-hi)', to = 'var(--fx-accent)', className }: { from?: string; to?: string; className?: string }) {
  return (
    <span aria-hidden className={cn('flex min-w-0', className)} style={{ '--dither-a': to, '--dither-b': from } as CSSProperties}>
      <span className="flex-1" style={{ background: from }} />
      <span className="flex-1 dither-25" />
      <span className="flex-1 dither-50" />
      <span className="flex-1 dither-75" />
      <span className="flex-1" style={{ background: to }} />
    </span>
  )
}

/** 14px close glyph: a 2px square-capped cross, the app's icon stroke. */
export function CloseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 14 14" aria-hidden className={cn('size-3.5', className)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="square">
      <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />
    </svg>
  )
}
