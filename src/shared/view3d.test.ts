import { describe, expect, it } from 'vitest'
import {
  customizeView3d,
  DEFAULT_VIEW3D,
  normalizeView3d,
  normalizeView3dStyle,
  sameView3dStyle,
  VIEW3D_LOOK_INFO,
  VIEW3D_LOOKS,
  view3dStyle
} from './view3d'

describe('3D view settings', () => {
  it('defaults to the lit look', () => {
    expect(normalizeView3d(null)).toEqual(DEFAULT_VIEW3D)
    expect(DEFAULT_VIEW3D.look).toBe('lit')
    expect(view3dStyle(DEFAULT_VIEW3D).shading).toBe('pixel')
  })

  it('has distinct, valid looks', () => {
    for (const [i, a] of VIEW3D_LOOKS.entries()) {
      const style = VIEW3D_LOOK_INFO[a].style
      expect(normalizeView3dStyle(style)).toEqual(style)
      for (const b of VIEW3D_LOOKS.slice(i + 1)) expect(sameView3dStyle(style, VIEW3D_LOOK_INFO[b].style)).toBe(false)
    }
  })

  it('keeps valid values and fills the rest', () => {
    const s = normalizeView3d({ look: 'custom', custom: { shading: 'vertex', fog: 3, dither: 'amiga', snap: 'yes' } })
    expect(s.look).toBe('custom')
    expect(s.custom).toMatchObject({ shading: 'vertex', fog: 1, dither: DEFAULT_VIEW3D.custom.dither, snap: DEFAULT_VIEW3D.custom.snap })
    expect(normalizeView3d({ look: 'crt' }).look).toBe(DEFAULT_VIEW3D.look)
  })

  it('makes an edited look the Custom style', () => {
    const s = customizeView3d({ ...DEFAULT_VIEW3D, look: 'psx' }, { resolution: '480' })
    expect(s.look).toBe('custom')
    expect(s.custom).toEqual({ ...VIEW3D_LOOK_INFO.psx.style, resolution: '480' })
    expect(customizeView3d(s, { fog: 0.5 }).custom).toEqual({ ...s.custom, fog: 0.5 })
  })

  it('turns the old PSX switches into the Custom style', () => {
    expect(normalizeView3d({ snap: false, affine: false, resolution: 'full', filter: false, lighting: true, dither: false })).toEqual(DEFAULT_VIEW3D)
    const s = normalizeView3d({ snap: true, affine: true, resolution: '240', filter: false, lighting: false, dither: true })
    expect(s.look).toBe('custom')
    expect(s.custom).toMatchObject({ snap: true, affine: true, resolution: '240', filter: 'nearest', shading: 'unlit', colorDepth: 'rgb555', dither: 'psx' })
  })
})
