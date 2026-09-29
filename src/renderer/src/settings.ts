// Remembered preferences (see UserSettings in @shared/api). Main loads them before the first
// render; the store keeps the live values and changes are sent back to be written to disk.

import { useSyncExternalStore } from 'react'
import { normalizeSettings, type MenuCommand, type UserSettings } from '@shared/api'
import { acceleratorOf } from '@shared/keybinds'
import { formatAccelerator } from '@shared/menu'
import { useApp } from './store'

let current: UserSettings = normalizeSettings(window.fx.settings)
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The saved settings, re-rendering the component whenever they change. */
export function useSavedSettings(): UserSettings {
  return useSyncExternalStore(subscribe, savedSettings)
}

export function savedSettings(): UserSettings {
  return current
}

export function saveSettings(patch: Partial<UserSettings>): void {
  const next = { ...current, ...patch }
  if ((Object.keys(patch) as (keyof UserSettings)[]).every((k) => next[k] === current[k])) return
  current = next
  window.fx.saveSettings(patch)
  for (const listener of listeners) listener()
}

/** A menu command's current shortcut as shown in tooltips ("Ctrl+O"; '' when it has none). */
export function shortcutText(command: MenuCommand, settings: UserSettings = current): string {
  const accelerator = acceleratorOf(command, settings.keybinds, window.fx.platform)
  return accelerator ? formatAccelerator(accelerator, window.fx.platform) : ''
}

/** "Open image (Ctrl+O)", or just the text when the command has no shortcut. */
export function withShortcut(text: string, command: MenuCommand, settings: UserSettings = current): string {
  const keys = shortcutText(command, settings)
  return keys ? `${text} (${keys})` : text
}

/**
 * Applies saved view settings to the store and saves them whenever they change; applies the
 * interface scale when Settings changes it (the preload applied the saved one before the first render).
 */
export function startSettingsSync(): () => void {
  const { grid, split, tile, theme, view3d, bake } = current
  useApp.setState({ grid, split, tile, theme, view3d, bake })
  let scale = current.uiScale
  const unsubscribeScale = subscribe(() => {
    if (current.uiScale === scale) return
    scale = current.uiScale
    window.fx.setUiScale(scale)
  })
  const unsubscribeStore = useApp.subscribe((s) => saveSettings({ grid: s.grid, split: s.split, tile: s.tile, theme: s.theme, view3d: s.view3d, bake: s.bake }))
  return () => {
    unsubscribeScale()
    unsubscribeStore()
  }
}
