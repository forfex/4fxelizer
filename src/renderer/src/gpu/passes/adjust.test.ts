import { describe, expect, it } from 'vitest'
import { adjustShading, DEFAULT_ADJUST } from './adjust'

describe('adjustShading', () => {
  it('builds no shading when AO and cavity are off', () => {
    expect(adjustShading(DEFAULT_ADJUST)).toBeNull()
  })

  it('multiplies the maps in with their own amounts', () => {
    const spec = adjustShading({ ...DEFAULT_ADJUST, ao: 0.8, cavity: 0.5 })
    expect(spec).toMatchObject({ a: 'map-ao', aAmount: 0.8, b: 'map-cavity', bAmount: 0.5, combine: 'multiply' })
  })

  it('uses only the cavity map when AO is off', () => {
    expect(adjustShading({ ...DEFAULT_ADJUST, cavity: 1 })).toMatchObject({ a: 'map-cavity', aAmount: 1, b: 'none' })
  })
})
