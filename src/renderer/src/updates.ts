// The update state main reports (see src/main/updater.ts), for the update window and Settings.

import { useSyncExternalStore } from 'react'
import type { UpdateState } from '@shared/update'
import { useApp } from './store'

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

/** Follows main's update state; a new version found at startup opens the update window. */
export function startUpdates(): () => void {
  let stopped = false
  const receive = (state: UpdateState): void => {
    if (stopped) return
    set(state)
    const app = useApp.getState()
    if (state.status === 'available' && state.prompt) app.setUpdateOpen(true)
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
