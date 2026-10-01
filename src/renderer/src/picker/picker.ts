// The screen picker's overlay window (one per display, opened by src/main/screenPicker.ts): shows
// that display's capture as it was when picking started, with a loupe by the pointer. Click picks
// a color, Shift+click picks and keeps going, Esc or a right click stops.

import { bgraToRgba, captureHexAt, type ScreenCapture } from '@shared/screenPick'
import { installPixelSnap } from '@/lib/pixelSnap'
import '../styles/fonts.css'
import './picker.css'

/** Pixels across the loupe (odd, so one sits in the middle). */
const LOUPE_PIXELS = 11

document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') ?? 'dark'
installPixelSnap()

const screenCanvas = document.getElementById('screen') as HTMLCanvasElement
const zoom = document.getElementById('zoom') as HTMLCanvasElement
const loupe = document.getElementById('loupe') as HTMLDivElement
const swatch = document.getElementById('swatch') as HTMLSpanElement
const hexText = document.getElementById('hex') as HTMLSpanElement
const hint = document.getElementById('hint') as HTMLDivElement

let capture: ScreenCapture | null = null
let picked = 0
let pointer: { x: number; y: number } | null = null

const token = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

function showHint(): void {
  hint.textContent = `Click to pick. Shift+click picks more. Esc stops.${picked ? ` ${picked} picked.` : ''}`
}

/** The capture pixel under a point of the window (CSS px). */
function pixelAt(x: number, y: number): { x: number; y: number } {
  const c = capture!
  return {
    x: Math.min(c.width - 1, Math.max(0, Math.floor((x / innerWidth) * c.width))),
    y: Math.min(c.height - 1, Math.max(0, Math.floor((y / innerHeight) * c.height)))
  }
}

function update(): void {
  if (!capture || !pointer) {
    loupe.hidden = true
    return
  }
  const p = pixelAt(pointer.x, pointer.y)
  const hex = captureHexAt(capture, p.x, p.y)
  swatch.style.backgroundColor = hex
  hexText.textContent = hex

  const size = Math.round(zoom.clientWidth * devicePixelRatio) || LOUPE_PIXELS * 12
  if (zoom.width !== size) zoom.width = zoom.height = size
  const ctx = zoom.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = token('--fx-well')
  ctx.fillRect(0, 0, size, size)
  const half = (LOUPE_PIXELS - 1) / 2
  const cell = size / LOUPE_PIXELS
  // Copy the visible part of the 11 × 11 neighborhood (drawImage won't read outside the image).
  const sx0 = Math.max(0, p.x - half)
  const sy0 = Math.max(0, p.y - half)
  const sx1 = Math.min(capture.width, p.x + half + 1)
  const sy1 = Math.min(capture.height, p.y + half + 1)
  ctx.drawImage(
    screenCanvas,
    sx0, sy0, sx1 - sx0, sy1 - sy0,
    (sx0 - (p.x - half)) * cell, (sy0 - (p.y - half)) * cell, (sx1 - sx0) * cell, (sy1 - sy0) * cell
  )
  const line = Math.max(1, Math.round(devicePixelRatio))
  ctx.lineWidth = line
  ctx.strokeStyle = token('--fx-focus') || token('--fx-magenta')
  ctx.strokeRect(half * cell + line / 2, half * cell + line / 2, cell - line, cell - line)

  // Below-right of the pointer, flipped to stay on screen.
  loupe.hidden = false
  const gap = 20
  const w = loupe.offsetWidth
  const h = loupe.offsetHeight
  const left = pointer.x + gap + w > innerWidth ? pointer.x - gap - w : pointer.x + gap
  const top = pointer.y + gap + h > innerHeight ? pointer.y - gap - h : pointer.y + gap
  loupe.style.transform = `translate(${Math.max(0, left)}px, ${Math.max(0, top)}px)`
}

window.picker.onCapture((c) => {
  capture = c
  picked = c.picked
  screenCanvas.width = c.width
  screenCanvas.height = c.height
  screenCanvas.getContext('2d')!.putImageData(new ImageData(bgraToRgba(c.bgra), c.width, c.height), 0, 0)
  showHint()
  update()
  // Shown once drawn, so the overlay never flashes black.
  requestAnimationFrame(() => window.picker.ready())
})

window.picker.onPicked((count) => {
  picked = count
  showHint()
})

addEventListener('pointermove', (e) => {
  pointer = { x: e.clientX, y: e.clientY }
  update()
})
addEventListener('pointerleave', () => {
  pointer = null
  update()
})
addEventListener('pointerdown', (e) => {
  if (!capture) return
  if (e.button === 2) return window.picker.done()
  if (e.button !== 0) return
  const p = pixelAt(e.clientX, e.clientY)
  window.picker.pick(captureHexAt(capture, p.x, p.y), e.shiftKey)
})
addEventListener('contextmenu', (e) => e.preventDefault())
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.picker.done()
})
