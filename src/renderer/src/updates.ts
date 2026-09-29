// The update state main reports (see src/main/updater.ts), for the update window and Settings.

import { useSyncExternalStore } from 'react'
import type { UpdateState } from '@shared/update'
import WHATS_NEW from '../../../WHATSNEW.md?raw'
import { confirmDiscard } from './projectActions'
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

let restarting = false

/**
 * Restarts into the downloaded update, after asking about unsaved work: a project's changes, and
 * also open textures that aren't in a project (the user didn't close the app, so nothing may be
 * lost without asking). Cancelling keeps the update ready for Restart now.
 */
export async function restartToUpdate(): Promise<void> {
  if (current.status !== 'ready' || restarting) return
  const version = current.release.version
  const app = useApp.getState()
  // The unsaved-changes question gets the screen.
  app.setUpdateOpen(false)
  restarting = true
  try {
    if (!(await confirmDiscard('updating', { unsavedWork: true }))) return
    app.setMessage({ kind: 'info', text: `Restarting to install version ${version}…` })
    window.fx.restartToUpdate()
  } finally {
    restarting = false
  }
}

/** Follows main's update state; a new version found at startup opens the update window. */
export function startUpdates(): () => void {
  showWhatsNewOnce()
  let stopped = false
  const receive = (state: UpdateState, initial = false): void => {
    if (stopped) return
    const was = current.status
    set(state)
    if ((state.status === 'available' || state.status === 'error') && state.prompt) openUpdateWindow()
    // Just downloaded (not a reloaded window finding it ready): restart into it.
    if (state.status === 'ready' && was !== 'ready' && !initial) void restartToUpdate()
  }
  const unsubscribe = window.fx.onUpdateState((state) => receive(state))
  window.fx.getUpdateState().then((state) => receive(state, true), () => {})
  return () => {
    stopped = true
    unsubscribe()
  }
}
