// Remembered preferences (see UserSettings in @shared/api). Main loads them before the first
// render; the store keeps the live values and changes are sent back to be written to disk.

import { useSyncExternalStore } from 'react'
import { normalizeSettings, type UserSettings } from '@shared/api'
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

/** Applies saved view settings to the store and saves them whenever they change. */
export function startSettingsSync(): () => void {
  useApp.setState({ grid: current.grid, split: current.split })
  return useApp.subscribe((s) => saveSettings({ grid: s.grid, split: s.split }))
}
