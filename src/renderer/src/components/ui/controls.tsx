// Form controls for stage and palette settings: numeric LCD fields, labeled sliders,
// checkboxes and segmented choices.

import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Slider } from './slider'

const clamp = (v: number, min: number, max: number): number => Math.min(Math.max(v, min), max)

function decimalsOf(step: number): number {
  const s = String(step)
  return s.includes('.') ? s.length - s.indexOf('.') - 1 : 0
}

/** Editable numeric readout in an LCD box. Commits on Enter/blur; ↑/↓ step (Shift = ×10). */
export function NumberField({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  suffix,
  className,
  disabled,
  title
}: {
  value: number
  onChange(value: number): void
  min?: number
  max?: number
  step?: number
  suffix?: string
  className?: string
  disabled?: boolean
  title?: string
}) {
  const format = (v: number): string => v.toFixed(decimalsOf(step))
  const [text, setText] = useState(format(value))
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (!editing) setText(format(value))
  }, [value, editing, step])

  const commit = (): void => {
    const v = parseFloat(text)
    if (Number.isFinite(v)) onChange(clamp(Math.round(v / step) * step, min, max))
    else setText(format(value))
    setEditing(false)
  }

  return (
    <span
      className={cn(
        'bevel-sunken inline-flex h-6 min-w-12 items-center rounded-fx bg-lcd px-1.5',
        'font-mono text-ui text-lcd-text tabular-nums',
        disabled && 'opacity-45',
        className
      )}
      title={title}
    >
      <input
        className="w-full min-w-0 bg-transparent text-right outline-none"
        value={text}
        disabled={disabled}
        inputMode="decimal"
        onFocus={(e) => {
          setEditing(true)
          e.currentTarget.select()
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setText(format(value))
            setEditing(false)
            e.currentTarget.blur()
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const v = clamp(value + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1), min, max)
            onChange(v)
            setText(format(v))
          }
        }}
      />
      {suffix && <span className="pl-0.5 text-lcd-text/70">{suffix}</span>}
    </span>
  )
}

/** Label + slider + numeric field on one row. */
export function ParamSlider({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step = 1,
  ticks = 0,
  suffix,
  disabled
}: {
  label: string
  hint?: string
  value: number
  onChange(value: number): void
  min: number
  max: number
  step?: number
  ticks?: number
  suffix?: string
  disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-2" title={hint}>
      <span className="w-20 shrink-0 truncate text-dim">{label}</span>
      <Slider
        className="min-w-0 flex-1"
        min={min}
        max={max}
        step={step}
        ticks={ticks}
        value={[clamp(value, min, max)]}
        disabled={disabled}
        onValueChange={([v]) => onChange(v!)}
        aria-label={label}
      />
      <NumberField className="w-16 shrink-0" value={value} onChange={onChange} min={min} max={max} step={step} suffix={suffix} disabled={disabled} />
    </div>
  )
}

/** Label column + control, for selects and other non-slider settings. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2" title={hint}>
      <span className="w-20 shrink-0 truncate text-dim">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
    </div>
  )
}

export function Checkbox({
  checked,
  onCheckedChange,
  label,
  hint,
  disabled,
  className
}: {
  checked: boolean
  onCheckedChange(checked: boolean): void
  label: ReactNode
  hint?: string
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      title={hint}
      onClick={() => onCheckedChange(!checked)}
      className={cn('inline-flex items-center gap-1.5 text-left disabled:opacity-45', className)}
    >
      <span className="bevel-sunken flex size-3.5 shrink-0 items-center justify-center bg-well text-small leading-none text-accent">
        {checked ? '✔' : ''}
      </span>
      <span>{label}</span>
    </button>
  )
}

/** Row of mutually exclusive beveled buttons. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  disabled,
  className
}: {
  value: T
  onChange(value: T): void
  options: readonly { value: T; label: string; hint?: string }[]
  disabled?: boolean
  className?: string
}) {
  return (
    <div role="radiogroup" className={cn('flex min-w-0 gap-px', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          aria-pressed={o.value === value}
          title={o.hint}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            'bevel-raised h-6 min-w-0 flex-1 truncate rounded-fx bg-panel-hi px-1.5 text-small',
            'aria-pressed:bevel-sunken aria-pressed:bg-well aria-pressed:text-accent disabled:opacity-45'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
