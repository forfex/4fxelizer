import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Teach tailwind-merge our custom font sizes, so `text-ui` isn't mistaken for a color
// and dropped when combined with `text-dim`.
const twMerge = extendTailwindMerge({
  extend: { theme: { text: ['ui', 'small'] } }
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
