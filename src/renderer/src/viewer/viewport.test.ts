import { describe, expect, it } from 'vitest'
import {
  fitView,
  MAX_ZOOM,
  MIN_ZOOM,
  pan,
  pixelAt,
  splitAtVisibleCenter,
  splitPosAt,
  splitScreenX,
  splitVisible,
  stepZoom,
  zoomAt
} from './viewport'

describe('viewport', () => {
  it('fits a small texture at an integer zoom, centered on whole pixels', () => {
    const view = fitView({ width: 64, height: 64 }, { width: 1000, height: 700 })
    expect(view.zoom).toBe(10)
    expect(view.x).toBe(180)
    expect(view.y).toBe(30)
  })

  it('fits a large texture below 1:1', () => {
    const view = fitView({ width: 4096, height: 4096 }, { width: 1000, height: 1000 })
    expect(view.zoom).toBeLessThan(1)
    expect(view.zoom * 4096).toBeLessThanOrEqual(1000 - 48)
  })

  it('steps through preset levels and clamps at the ends', () => {
    expect(stepZoom(1, 1)).toBe(2)
    expect(stepZoom(1, -1)).toBe(2 / 3)
    expect(stepZoom(1.5, 1)).toBe(2)
    expect(stepZoom(1.5, -1)).toBe(1)
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM)
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM)
  })

  it('keeps the anchored image point under the cursor when zooming', () => {
    const view = { zoom: 2, x: 100, y: 50 }
    const anchor = { x: 300, y: 250 } // image point (100, 100)
    const next = zoomAt(view, 8, anchor)
    expect((anchor.x - next.x) / next.zoom).toBeCloseTo(100, 0)
    expect((anchor.y - next.y) / next.zoom).toBeCloseTo(100, 0)
    expect(Number.isInteger(next.x) && Number.isInteger(next.y)).toBe(true)
  })

  it('maps canvas points to image pixels', () => {
    const view = { zoom: 4, x: 10, y: 10 }
    const image = { width: 16, height: 16 }
    expect(pixelAt(view, image, { x: 10, y: 10 })).toEqual({ x: 0, y: 0 })
    expect(pixelAt(view, image, { x: 13.9, y: 14 })).toEqual({ x: 0, y: 1 })
    expect(pixelAt(view, image, { x: 9, y: 10 })).toBeNull()
    expect(pixelAt(view, image, { x: 10 + 64, y: 10 })).toBeNull()
  })

  it('anchors the split divider to the image, so it follows pans and zooms', () => {
    const image = { width: 100, height: 100 }
    const view = { zoom: 2, x: 50, y: 0 }
    expect(splitScreenX(view, image, 0.5)).toBe(150)
    expect(splitScreenX(pan(view, 30, 0), image, 0.5)).toBe(180)
    expect(splitScreenX(zoomAt(view, 4, { x: 150, y: 0 }), image, 0.5)).toBe(150)
    expect(splitPosAt(view, image, 150)).toBe(0.5)
    expect(splitPosAt(view, image, 0)).toBe(0)
    expect(splitPosAt(view, image, 1000)).toBe(1)
    // Snapped to whole image columns.
    expect(splitScreenX({ zoom: 8, x: 0, y: 0 }, { width: 3, height: 1 }, 0.5)).toBe(16)
  })

  it('finds the visible middle of the image for an off-screen divider', () => {
    const image = { width: 100, height: 100 }
    const canvas = { width: 200, height: 200 }
    const view = { zoom: 4, x: -300, y: 0 } // columns 75..125 visible → 75..100
    expect(splitVisible(view, image, canvas, 0.2)).toBe(false)
    expect(splitAtVisibleCenter(view, image, canvas)).toBeCloseTo(0.875)
  })
})
