import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-fx font-ui text-ui',
    'bevel-raised select-none transition-none',
    'active:bevel-sunken active:translate-y-px',
    'aria-pressed:bevel-sunken aria-pressed:bg-well',
    'disabled:pointer-events-none disabled:opacity-45'
  ],
  {
    variants: {
      variant: {
        default: 'bg-panel-hi text-text hover:brightness-110',
        primary: 'bg-accent text-accent-text hover:brightness-105',
        ghost: 'bg-transparent shadow-none hover:bg-panel-hi hover:bevel-raised'
      },
      size: {
        sm: 'h-6 px-2',
        md: 'h-7 px-3',
        icon: 'h-7 w-7 px-0'
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
