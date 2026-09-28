/**
 * Keeps `--px` equal to a whole number of device pixels (at least one), expressed in CSS px.
 * At 125% scaling 1 CSS px = 1.25 device px, which blurs 1px lines; --px = 0.8px there
 * gives exactly one device pixel instead. Updates when the window moves between monitors.
 */
export function installPixelSnap(): void {
  const update = (): void => {
    const dpr = window.devicePixelRatio || 1
    const devicePixels = Math.max(1, Math.round(dpr))
    document.documentElement.style.setProperty('--px', `${devicePixels / dpr}px`)
    matchMedia(`(resolution: ${dpr}dppx)`).addEventListener('change', update, { once: true })
  }
  update()
}

/** Reads a CSS color token as normalized RGBA (for the GPU viewer). */
export function cssColor(token: string): [number, number, number, number] {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
  const ctx = new OffscreenCanvas(1, 1).getContext('2d')!
  ctx.fillStyle = value || '#000'
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
  return [r! / 255, g! / 255, b! / 255, a! / 255]
}
