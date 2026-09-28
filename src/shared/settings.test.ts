import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, normalizeSettings } from './api'

describe('settings', () => {
  it('defaults: pixel grid off, split on', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(DEFAULT_SETTINGS.grid).toBe(false)
  })

  it('keeps valid values and replaces invalid or unknown ones', () => {
    expect(normalizeSettings({ grid: true, split: 'yes', exportFormat: 'png-rgba', extra: 1 })).toEqual({
      grid: true,
      split: true,
      exportFormat: 'png-rgba'
    })
    expect(normalizeSettings({ exportFormat: 'tiff' }).exportFormat).toBe('png-indexed')
    for (const f of ['tga-indexed', 'tga-rgba', 'bmp-indexed', 'bmp-rgba']) expect(normalizeSettings({ exportFormat: f }).exportFormat).toBe(f)
    expect(normalizeSettings({ exportFormat: 'bmp-cmyk' }).exportFormat).toBe('png-indexed')
  })
})
