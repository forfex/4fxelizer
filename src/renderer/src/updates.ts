// The update state main reports (see src/main/updater.ts), for the update window and Settings.

import { useSyncExternalStore } from 'react'
import type { UpdateState } from '@shared/update'
import WHATS_NEW from '../../../WHATSNEW.md?raw'
import { savedSettings, saveSettings } from './settings'
import { useApp } from './store'

export { WHATS_NEW }

let current: UpdateState = { status: 'idle' }
const listeners = new Set<() => void>()

function set(next: UpdateState): void {
  current = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useUpdateState(): UpdateState {
  return useSyncExternalStore(subscribe, () => current)
}

/** Opens the update window, after What's new if that is showing (one window at a time). */
function openUpdateWindow(): void {
  if (!useApp.getState().whatsNewOpen) return useApp.getState().setUpdateOpen(true)
  const unsubscribe = useApp.subscribe((s) => {
    if (s.whatsNewOpen) return
    unsubscribe()
    s.setUpdateOpen(true)
  })
}

/**
 * The first launch of a version (a new install, or after updating) shows its What's new once.
 * Development builds skip it.
 */
function showWhatsNewOnce(): void {
  const { updates } = savedSettings()
  if (import.meta.env.DEV || updates.seen === window.fx.version) return
  saveSettings({ updates: { ...updates, seen: window.fx.version } })
  if (WHATS_NEW.trim()) useApp.getState().setWhatsNewOpen(true)
}

/** Follows main's update state; a new version found at startup opens the update window. */
export function startUpdates(): () => void {
  showWhatsNewOnce()
  let stopped = false
  const receive = (state: UpdateState): void => {
    if (stopped) return
    set(state)
    const app = useApp.getState()
    if (state.status === 'available' && state.prompt) openUpdateWindow()
    // Quitting to install: the unsaved-changes question may come up, so it gets the screen.
    if (state.status === 'ready') {
      app.setUpdateOpen(false)
      app.setMessage({ kind: 'info', text: `Restarting to install version ${state.release.version}…` })
    }
  }
  const unsubscribe = window.fx.onUpdateState(receive)
  window.fx.getUpdateState().then(receive, () => {})
  return () => {
    stopped = true
    unsubscribe()
  }
}
