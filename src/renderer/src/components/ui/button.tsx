import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

// Beveled push buttons inside a 1px ink outline. Pressed (or aria-pressed) sinks into a well.
// The primary button sits on its hard offset shadow and moves onto it when pressed.
const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-fx border-px font-ui font-medium',
    'select-none transition-none [&_svg]:size-3.5 [&_svg]:shrink-0',
    'disabled:pointer-events-none disabled:opacity-45'
  ],
  {
    variants: {
      variant: {
        default: [
          'border-edge bg-panel-hi text-text bevel-raised hover:bg-hover',
          'active:bg-well active:bevel-sunken',
          'aria-pressed:bg-well aria-pressed:text-accent-hi aria-pressed:bevel-sunken'
        ],
        primary: [
          'border-edge bg-accent font-semibold text-accent-text hover:bg-accent-hi',
          'shadow-[inset_var(--px)_var(--px)_0_var(--fx-accent-hi),var(--fx-shadow-hard)]',
          'active:translate-x-0.5 active:translate-y-0.5 active:bg-accent active:shadow-none'
        ],
        ghost: [
          'border-transparent bg-transparent text-text shadow-none',
          'hover:border-edge hover:bg-panel-hi hover:bevel-raised',
          'active:bg-well active:bevel-sunken aria-pressed:border-edge aria-pressed:bg-well aria-pressed:bevel-sunken'
        ]
      },
      size: {
        sm: 'h-5 px-2 text-small',
        md: 'h-control px-2.5 text-ui',
        icon: 'size-control px-0 text-ui'
      }
    },
    defaultVariants: { variant: 'default', size: 'md' }
  }
)

export type ButtonProps = ComponentProps<'button'> & VariantProps<typeof buttonVariants>

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
}

export { buttonVariants }
