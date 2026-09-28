import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Teach tailwind-merge our custom font sizes, radii, shadows and line utilities, so `text-ui` /
// `outline-px` aren't mistaken for colors and dropped when combined with `text-dim` / `outline-accent`.
const twMerge = extendTailwindMerge({
  extend: {
    theme: { text: ['ui', 'small', 'lcd'], radius: ['fx', 'fx-md', 'fx-lg'], shadow: ['hard', 'window', 'glow'] },
    classGroups: { 'outline-w': ['outline-px'] }
  }
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
