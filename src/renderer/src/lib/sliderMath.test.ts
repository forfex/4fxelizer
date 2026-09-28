import { describe, expect, it } from 'vitest'
import { logToPosition, positionToLog, snapToStep, wheelLogValue, wheelValue } from './sliderMath'

describe('snapToStep', () => {
  it('snaps, clamps and drops float noise', () => {
    expect(snapToStep(0.1 + 0.2, 0, 1, 0.01)).toBe(0.3)
    expect(snapToStep(7.4, 2, 16, 1)).toBe(7)
    expect(snapToStep(-5, 0, 1, 0.01)).toBe(0)
  })
})

describe('wheelValue', () => {
  it('moves one step per notch on small ranges', () => {
    expect(wheelValue(0.5, 1, 0, 1, 0.01)).toBe(0.51)
    expect(wheelValue(0.5, -2, 0, 1, 0.01)).toBe(0.48)
    expect(wheelValue(4, 1, 1, 8, 1)).toBe(5)
  })

  it('moves ten times as far with Shift', () => {
    expect(wheelValue(0.5, 1, 0, 1, 0.01, true)).toBe(0.6)
  })

  it('moves 1% of the range on long sliders', () => {
    expect(wheelValue(100, 1, 0, 1000, 1)).toBe(110)
  })

  it('stays inside the range', () => {
    expect(wheelValue(1, 3, 0, 1, 0.01)).toBe(1)
  })
})

describe('log slider', () => {
  it('maps positions to values and back', () => {
    expect(positionToLog(0, 2, 8192, 1)).toBe(2)
    expect(positionToLog(1000, 2, 8192, 1)).toBe(8192)
    expect(positionToLog(logToPosition(256, 2, 8192), 2, 8192, 1)).toBe(256)
  })

  it('always moves at least one step per wheel notch', () => {
    expect(wheelLogValue(2, 1, 2, 8192, 1)).toBe(3)
    expect(wheelLogValue(3, -1, 2, 8192, 1)).toBe(2)
    expect(wheelLogValue(1000, 1, 2, 8192, 1)).toBe(1100)
    expect(wheelLogValue(16, 1, 2, 8192, 1, true)).toBe(32)
  })
})
