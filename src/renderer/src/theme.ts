// Applies the interface theme: `data-theme` on <html> switches the token values in styles/tokens.css.
// Things that read tokens once (the native window buttons, the GPU viewer) re-read them when
// `theme` in the store changes.

import { useApp } from './store'

export function startThemeSync(): () => void {
  const apply = (theme: string): void => {
    document.documentElement.dataset.theme = theme
  }
  apply(useApp.getState().theme)
  return useApp.subscribe((s, prev) => {
    if (s.theme !== prev.theme) apply(s.theme)
  })
}
