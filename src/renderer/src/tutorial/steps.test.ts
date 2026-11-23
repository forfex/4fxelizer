import { describe, expect, it } from 'vitest'
import { CALLOUT_GAP, placeCallout, TUTORIAL_STEPS } from './steps'
import { sampleTexture } from './sample'

const viewport = { width: 1400, height: 900 }
const size = { width: 340, height: 220 }

describe('tutorial steps', () => {
  it('have unique ids, a title and text', () => {
    expect(new Set(TUTORIAL_STEPS.map((s) => s.id)).size).toBe(TUTORIAL_STEPS.length)
    for (const step of TUTORIAL_STEPS) {
      expect(step.title).not.toBe('')
      expect(step.text.length).toBeGreaterThan(0)
      // A step that asks for something says what.
      if (step.check) expect(step.task).toBeTruthy()
    }
  })

  it('cover the stack and palettes', () => {
    const targets = TUTORIAL_STEPS.map((s) => s.target)
    for (const t of ['stack', 'stage-downscale', 'stage-dither', 'palette-list', 'palette-generate', 'palette-colors']) expect(targets).toContain(t)
  })
})

describe('placeCallout', () => {
  const inside = (p: { x: number; y: number }): void => {
    expect(p.x).toBeGreaterThanOrEqual(CALLOUT_GAP)
    expect(p.y).toBeGreaterThanOrEqual(CALLOUT_GAP)
    expect(p.x + size.width).toBeLessThanOrEqual(viewport.width - CALLOUT_GAP)
    expect(p.y + size.height).toBeLessThanOrEqual(viewport.height - CALLOUT_GAP)
  }

  it('centers without a target', () => {
    expect(placeCallout(null, size, viewport)).toEqual({ x: 530, y: 340 })
  })

  it('goes to the right of a target on the left side', () => {
    const p = placeCallout({ x: 10, y: 100, width: 300, height: 400 }, size, viewport)
    expect(p).toEqual({ x: 322, y: 100 })
  })

  it('goes to the left of a target at the right edge', () => {
    const p = placeCallout({ x: 1080, y: 100, width: 310, height: 300 }, size, viewport)
    expect(p.x).toBe(1080 - size.width - CALLOUT_GAP)
    inside(p)
  })

  it('goes below a wide target at the top, above one at the bottom', () => {
    expect(placeCallout({ x: 0, y: 30, width: 1400, height: 40 }, size, viewport).y).toBe(82)
    const above = placeCallout({ x: 0, y: 860, width: 1400, height: 40 }, size, viewport)
    expect(above.y).toBe(860 - size.height - CALLOUT_GAP)
    inside(above)
  })

  it('stays inside the window whatever the target', () => {
    inside(placeCallout({ x: 0, y: 0, width: 1400, height: 900 }, size, viewport))
    inside(placeCallout({ x: 200, y: 850, width: 100, height: 200 }, size, viewport))
  })
})

describe('sampleTexture', () => {
  it('is an opaque, varied image that is the same every time', () => {
    const a = sampleTexture()
    expect(a.data.length).toBe(a.width * a.height * 4)
    expect(a.data).toEqual(sampleTexture().data)
    const colors = new Set<number>()
    for (let i = 0; i < a.data.length; i += 4) {
      expect(a.data[i + 3]).toBe(255)
      colors.add((a.data[i]! << 16) | (a.data[i + 1]! << 8) | a.data[i + 2]!)
    }
    // Enough colors that reducing them is visible.
    expect(colors.size).toBeGreaterThan(1000)
  })
})
