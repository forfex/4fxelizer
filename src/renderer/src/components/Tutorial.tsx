// The tutorial (Help › Tutorial, offered on the first launch): a callout that walks through the
// basics, with an outline around the part of the window each step is about. It never blocks the
// app: only the callout takes clicks, so the artist can try what a step describes.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { openDroppedFiles, openImage } from '@/actions'
import { downscaleSize, type DownscaleParams } from '@/gpu/passes/downscale'
import { encodePng } from '@/image/png'
import { savedSettings, saveSettings } from '@/settings'
import { ownedPalette } from '@/stack/doc'
import { useApp, type AppState } from '@/store'
import { SAMPLE_NAME, sampleTexture } from '@/tutorial/sample'
import { placeCallout, TUTORIAL_STEPS, type Rect, type TutorialCheck, type TutorialPrepare } from '@/tutorial/steps'
import { revealPanel } from '@/workspace/workspace'
import { Button } from './ui/button'
import { Dialog, DialogContent } from './ui/dialog'
import { CloseIcon, DitherRamp, Led } from './ui/retro'

/** How often the outline follows its target (panels resize, scroll and dock while the tour is open). */
const FOLLOW_MS = 150
const CALLOUT_WIDTH = 340

/** Offers the tutorial on the first launch, once What's new (if showing) is closed. */
export function startTutorialPrompt(): () => void {
  if (savedSettings().tutorialSeen) return () => {}
  const offer = (): void => {
    saveSettings({ tutorialSeen: true })
    useApp.getState().setTutorialPromptOpen(true)
  }
  if (!useApp.getState().whatsNewOpen) {
    offer()
    return () => {}
  }
  const unsubscribe = useApp.subscribe((s) => {
    if (s.whatsNewOpen) return
    unsubscribe()
    offer()
  })
  return unsubscribe
}

export function startTutorial(): void {
  const app = useApp.getState()
  app.setTutorialPromptOpen(false)
  app.setTutorialStep(0)
}

async function openSample(): Promise<void> {
  await openDroppedFiles([{ name: SAMPLE_NAME, bytes: await encodePng(sampleTexture()) }])
}

function prepare(what: TutorialPrepare | undefined): void {
  if (!what) return
  const app = useApp.getState()
  const stageOf = (passId: string): string | undefined => app.stages.find((s) => s.passId === passId)?.uid
  if (what === 'palettes') {
    revealPanel('palettes')
    // Show the palette the stack's Dither (or Quantize) stage made for itself. A stage that is
    // switched off generates no colors, so the tour turns it on if the artist skipped that step.
    const owner = app.stages.find((s) => ownedPalette(app, s.uid))
    if (owner && !owner.enabled) app.updateStage(owner.uid, { enabled: true })
    const palette = owner && ownedPalette(app, owner.uid)
    if (palette) app.selectPalette(palette.id)
    return
  }
  revealPanel('stack')
  const uid = what === 'open-downscale' ? stageOf('downscale') : what === 'open-dither' ? stageOf('dither') : undefined
  if (uid) app.setStageOpen(uid, true)
}

function checked(check: TutorialCheck, s: AppState): boolean {
  if (check === 'image') return !!s.image
  if (check === 'dither-on') return s.stages.some((st) => st.passId === 'dither' && st.enabled)
  const image = s.image
  if (!image) return false
  return s.stages.some((st) => {
    if (st.passId !== 'downscale' || !st.enabled) return false
    const out = downscaleSize(image, st.params as DownscaleParams)
    return out.width < image.width || out.height < image.height
  })
}

/** The step's target on screen, followed while the step shows; null when it has none or it isn't visible. */
function useTargetRect(target: string | undefined, step: number): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null)
  useEffect(() => {
    if (!target) {
      setRect(null)
      return
    }
    const find = (): HTMLElement | null => document.querySelector<HTMLElement>(`[data-tour="${target}"]`)
    // The panel a step reveals renders a moment later.
    const scroll = window.setTimeout(() => find()?.scrollIntoView({ block: 'nearest' }), 60)
    const measure = (): void => {
      const r = find()?.getBoundingClientRect()
      const next = r && r.width > 0 && r.height > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null
      setRect((prev) =>
        prev && next && prev.x === next.x && prev.y === next.y && prev.width === next.width && prev.height === next.height ? prev : next
      )
    }
    measure()
    const timer = window.setInterval(measure, FOLLOW_MS)
    return () => {
      window.clearTimeout(scroll)
      window.clearInterval(timer)
    }
  }, [target, step])
  return rect
}

export function Tutorial() {
  const index = useApp((s) => s.tutorialStep)
  if (index === null) return null
  return <TutorialStepView index={Math.min(index, TUTORIAL_STEPS.length - 1)} />
}

function TutorialStepView({ index }: { index: number }) {
  const step = TUTORIAL_STEPS[index]!
  const last = index === TUTORIAL_STEPS.length - 1
  const done = useApp((s) => (step.check ? checked(step.check, s) : false))
  const hasImage = useApp((s) => !!s.image)
  const gpuReady = useApp((s) => s.gpu.status === 'ready')
  const { setTutorialStep } = useApp.getState()
  const rect = useTargetRect(step.target, index)
  const callout = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => prepare(step.prepare), [step])

  useLayoutEffect(() => {
    const place = (): void => {
      const el = callout.current
      if (!el) return
      setPosition(placeCallout(rect, { width: el.offsetWidth, height: el.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }))
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [rect, index, done, hasImage])

  return (
    <div className="pointer-events-none fixed inset-0 z-50" aria-live="polite">
      {rect && (
        <div
          className="absolute rounded-fx-md outline-2 outline-focus outline-solid"
          style={{ left: rect.x - 3, top: rect.y - 3, width: rect.width + 6, height: rect.height + 6 }}
        />
      )}
      <div
        ref={callout}
        role="dialog"
        aria-label={`Tutorial: ${step.title}`}
        className="pointer-events-auto absolute flex flex-col overflow-hidden rounded-fx-lg bg-panel window-frame"
        style={{ width: CALLOUT_WIDTH, left: position?.x ?? 0, top: position?.y ?? 0, visibility: position ? 'visible' : 'hidden' }}
      >
        <div className="flex h-8 shrink-0 items-center gap-2 border-b-2 border-edge bg-panel-hi pr-1 pl-3 shadow-[inset_var(--px)_var(--px)_0_var(--fx-bevel-light)]">
          <span className="font-display text-[14px] leading-[18px] font-bold tracking-[0.02em] whitespace-nowrap">{step.title}</span>
          <DitherRamp className="h-2.5 flex-1" />
          <span className="font-mono text-small text-dim">
            {index + 1}/{TUTORIAL_STEPS.length}
          </span>
          <button
            type="button"
            aria-label="Close the tutorial"
            title="Close the tutorial (Help › Tutorial opens it again)"
            className="bevel-raised flex size-6 items-center justify-center rounded-fx border-px border-edge bg-panel-hi text-text hover:bg-hover active:bg-well active:bevel-sunken"
            onClick={() => setTutorialStep(null)}
          >
            <CloseIcon />
          </button>
        </div>
        <div className="flex flex-col gap-2 p-3">
          {step.text.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          {step.task && (
            <p className="flex items-center gap-2 text-dim">
              <Led state={done ? 'on' : 'off'} />
              <span>{done ? 'Done.' : step.task}</span>
            </p>
          )}
          {step.check === 'image' && !hasImage && (
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="primary" disabled={!gpuReady} onClick={() => void openSample()}>
                Use the sample texture
              </Button>
              <Button size="sm" disabled={!gpuReady} onClick={() => void openImage()}>
                Open…
              </Button>
            </div>
          )}
          <div className="mt-1 flex items-center justify-end gap-1">
            <Button size="sm" disabled={index === 0} onClick={() => setTutorialStep(index - 1)}>
              Back
            </Button>
            <Button size="sm" variant="primary" onClick={() => setTutorialStep(last ? null : index + 1)}>
              {last ? 'Finish' : 'Next'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** First launch: offers the tour. */
export function TutorialPrompt() {
  const open = useApp((s) => s.tutorialPromptOpen)
  const setOpen = useApp((s) => s.setTutorialPromptOpen)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title="Welcome to 4FXELIZER" className="w-[min(440px,90vw)]">
        <div className="flex flex-col gap-3">
          <p>New here? A short tour shows the basics: how the stack works and how to use palettes. It takes a few minutes.</p>
          <p className="text-dim">You can open it any time from Help › Tutorial.</p>
          <div className="flex justify-end gap-1">
            <Button onClick={() => setOpen(false)}>Not now</Button>
            <Button variant="primary" autoFocus onClick={startTutorial}>
              Start the tutorial
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
