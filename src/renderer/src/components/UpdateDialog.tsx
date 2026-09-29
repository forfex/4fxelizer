import { useMemo } from 'react'
import type { UpdateState } from '@shared/update'
import { parseNotes, type Span } from '@/lib/releaseNotes'
import { saveSettings, useSavedSettings } from '@/settings'
import { useApp } from '@/store'
import { useUpdateState, WHATS_NEW } from '@/updates'
import { Button } from './ui/button'
import { Dialog, DialogContent } from './ui/dialog'
import { Led, type LedState } from './ui/retro'

const MB = 1024 * 1024

function describe(state: UpdateState): { led: LedState; text: string } {
  const version = window.fx.version
  switch (state.status) {
    case 'idle':
      return { led: 'off', text: `You have version ${version}.` }
    case 'checking':
      return { led: 'busy', text: 'Checking for updates…' }
    case 'up-to-date':
      return { led: 'on', text: `Version ${version} is the latest.` }
    case 'available':
      return { led: 'warn', text: `Version ${state.release.version} is available. You have ${version}.` }
    case 'downloading': {
      const pct = state.total ? Math.floor((state.received / state.total) * 100) : 0
      return { led: 'busy', text: `Downloading ${state.release.version}… ${pct}% (${(state.received / MB).toFixed(1)} of ${(state.total / MB).toFixed(1)} MB)` }
    }
    case 'ready':
      return { led: 'busy', text: `Version ${state.release.version} is downloaded. The app restarts to install it.` }
    case 'error':
      return { led: 'error', text: state.message }
  }
}

const spans = (list: Span[]) =>
  list.map((s, i) =>
    s.code ? (
      <code key={i} className="font-mono text-small">
        {s.text}
      </code>
    ) : s.bold ? (
      <strong key={i}>{s.text}</strong>
    ) : (
      s.text
    )
  )

function ReleaseNotes({ markdown }: { markdown: string }) {
  const blocks = useMemo(() => parseNotes(markdown), [markdown])
  return (
    <div className="flex max-h-56 flex-col gap-1 overflow-auto rounded-fx border-px border-edge bg-well p-2 bevel-sunken">
      {blocks.map((b, i) =>
        b.kind === 'heading' ? (
          <p key={i} className="pt-1 font-display font-bold tracking-[0.02em] first:pt-0">
            {spans(b.spans)}
          </p>
        ) : b.kind === 'item' ? (
          <p key={i} className="relative pl-3.5 before:absolute before:top-[0.55em] before:left-1 before:size-1 before:bg-dim">
            {spans(b.spans)}
          </p>
        ) : (
          <p key={i}>{spans(b.spans)}</p>
        )
      )}
    </div>
  )
}

/** One line saying where updating stands: LED, text and a progress bar while downloading. */
export function UpdateStatus() {
  const state = useUpdateState()
  const { led, text } = describe(state)
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <Led state={led} />
        <span className="min-w-0" role="status">
          {text}
        </span>
      </div>
      {state.status === 'downloading' && (
        <div
          className="bevel-sunken h-2.5 overflow-hidden rounded-fx border-px border-edge bg-well"
          role="progressbar"
          aria-valuenow={state.total ? Math.floor((state.received / state.total) * 100) : 0}
        >
          <div className="h-full bg-accent" style={{ width: `${state.total ? (state.received / state.total) * 100 : 0}%` }} />
        </div>
      )}
    </div>
  )
}

/** The button that acts on the state: check, update (or download from the release page), retry, restart. */
export function UpdateAction({ primary = false }: { primary?: boolean }) {
  const state = useUpdateState()
  const variant = primary ? 'primary' : 'default'
  switch (state.status) {
    case 'available':
      return (
        <Button variant={variant} onClick={() => window.fx.installUpdate()}>
          {state.installable ? 'Update and restart' : 'Download…'}
        </Button>
      )
    case 'error':
      return state.release ? (
        <Button variant={variant} onClick={() => window.fx.installUpdate()}>
          Try again
        </Button>
      ) : (
        <Button onClick={() => window.fx.checkForUpdates()}>Check again</Button>
      )
    case 'ready':
      return (
        <Button variant={variant} onClick={() => window.fx.installUpdate()}>
          Restart now
        </Button>
      )
    default:
      return (
        <Button disabled={state.status === 'checking' || state.status === 'downloading'} onClick={() => window.fx.checkForUpdates()}>
          Check for updates
        </Button>
      )
  }
}

/** A new version found at startup, or Help › Check for Updates: what's new, and whether to update. */
export function UpdateDialog() {
  const open = useApp((s) => s.updateOpen)
  const setOpen = useApp((s) => s.setUpdateOpen)
  const state = useUpdateState()
  const { updates } = useSavedSettings()
  const release = 'release' in state ? state.release : undefined
  const offered = state.status === 'available'

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title="Update" className="w-[min(520px,90vw)]">
        <div className="flex flex-col gap-3">
          <UpdateStatus />
          {release?.notes && (
            <div className="flex flex-col gap-1">
              <h3 className="text-dim label-caps">What's new in {release.version}</h3>
              <ReleaseNotes markdown={release.notes} />
            </div>
          )}
          {release && (
            <a href={release.page} target="_blank" rel="noreferrer" className="self-start text-small text-accent-hi underline">
              Full release notes on GitHub
            </a>
          )}
          {offered && (
            <p className="text-small text-dim">
              {state.installable
                ? 'The app restarts to install the update. You are asked to save unsaved project changes first.'
                : 'This copy of the app can’t update itself. Download opens the release page to get the new version.'}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-1.5">
            <UpdateAction primary />
            {offered && (
              <Button
                onClick={() => {
                  saveSettings({ updates: { ...updates, skipped: state.release.version } })
                  setOpen(false)
                }}
              >
                Skip this version
              </Button>
            )}
            <Button onClick={() => setOpen(false)}>{offered ? 'Later' : 'Close'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** This version's What's new (WHATSNEW.md, bundled), shown once on its first launch. */
export function WhatsNewDialog() {
  const open = useApp((s) => s.whatsNewOpen)
  const setOpen = useApp((s) => s.setWhatsNewOpen)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title={`What's new in ${window.fx.version}`} className="w-[min(520px,90vw)]">
        <div className="flex flex-col gap-3">
          <ReleaseNotes markdown={WHATS_NEW} />
          <div className="flex justify-end">
            <Button variant="primary" autoFocus onClick={() => setOpen(false)}>
              OK
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
