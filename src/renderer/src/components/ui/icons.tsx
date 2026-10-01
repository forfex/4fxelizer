// 14px icons on a 14 × 14 grid, drawn with a 2px square-capped stroke in currentColor (the
// design system's icon rule). Always used with an aria-label or a text label.

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

function Icon({ className, children, filled }: { className?: string; children: ReactNode; filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 14 14"
      aria-hidden
      className={cn('size-3.5 shrink-0', className)}
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={2}
      strokeLinecap="square"
      strokeLinejoin="miter"
    >
      {children}
    </svg>
  )
}

type P = { className?: string }

/** Preview the image at a stage: a target. */
export const PreviewIcon = ({ className }: P) => (
  <Icon className={className}>
    <rect x="2" y="2" width="10" height="10" />
    <rect x="6" y="6" width="2" height="2" fill="currentColor" stroke="none" />
  </Icon>
)

/** More actions: three square dots. */
export const MoreIcon = ({ className }: P) => (
  <Icon className={className} filled>
    <rect x="1" y="6" width="3" height="3" />
    <rect x="5.5" y="6" width="3" height="3" />
    <rect x="10" y="6" width="3" height="3" />
  </Icon>
)

/** Disclosure caret: points down when open, right when closed. */
export const CaretIcon = ({ open, className }: P & { open: boolean }) => (
  <Icon className={cn('size-2.5', className)} filled>
    {open ? <path d="M2 4h10l-5 6z" /> : <path d="M4 2v10l6-5z" />}
  </Icon>
)

export const UndoIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M4 3L2 5.5 4 8" />
    <path d="M2.5 5.5h6a3 3 0 010 6H6" />
  </Icon>
)

export const RedoIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M10 3l2 2.5L10 8" />
    <path d="M11.5 5.5h-6a3 3 0 000 6H8" />
  </Icon>
)

export const PlusIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M7 2.5v9M2.5 7h9" />
  </Icon>
)

/** Settings: two slider tracks with their knobs. */
export const SettingsIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M1 4h12M1 10h12" />
    <rect x="3" y="1" width="3" height="6" fill="currentColor" stroke="none" />
    <rect x="8" y="7" width="3" height="6" fill="currentColor" stroke="none" />
  </Icon>
)

export const MinusIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M2.5 7h9" />
  </Icon>
)

/** Pick from screen: a monitor with one pixel in the middle. */
export const ScreenPickIcon = ({ className }: P) => (
  <Icon className={className}>
    <rect x="2" y="2" width="10" height="7" />
    <path d="M7 9v3M4 12.5h6" />
    <rect x="6" y="4.5" width="2" height="2" fill="currentColor" stroke="none" />
  </Icon>
)
