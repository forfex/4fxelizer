import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, MAX_WORKSPACES, normalizeSettings } from './api'

describe('settings', () => {
  it('defaults: pixel grid off, split on', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(DEFAULT_SETTINGS.grid).toBe(false)
  })

  it('keeps valid values and replaces invalid or unknown ones', () => {
    expect(normalizeSettings({ grid: true, split: 'yes', exportFormat: 'png-rgba', extra: 1 })).toEqual({
      grid: true,
      split: true,
      tile: false,
      exportFormat: 'png-rgba',
      layout: null,
      workspace: 'essentials',
      workspaces: []
    })
    expect(normalizeSettings({ exportFormat: 'tiff' }).exportFormat).toBe('png-indexed')
    for (const f of ['tga-indexed', 'tga-rgba', 'bmp-indexed', 'bmp-rgba']) expect(normalizeSettings({ exportFormat: f }).exportFormat).toBe(f)
    expect(normalizeSettings({ exportFormat: 'bmp-cmyk' }).exportFormat).toBe('png-indexed')
  })

  it('keeps panel layouts and saved workspaces, dropping broken entries', () => {
    const layout = { grid: {} }
    const s = normalizeSettings({
      layout,
      workspace: 'Mine',
      workspaces: [{ name: ' Mine ', layout }, { name: '', layout }, { name: 'x', layout: 'nope' }, 7, { name: 'Mine', layout: { v: 2 } }]
    })
    expect(s.layout).toBe(layout)
    expect(s.workspace).toBe('Mine')
    expect(s.workspaces).toEqual([{ name: 'Mine', layout: { v: 2 } }])
    expect(normalizeSettings({ layout: [1], workspace: '  ' })).toMatchObject({ layout: null, workspace: 'essentials' })
  })

  it('trims the active workspace name and keeps only the newest saved workspaces', () => {
    expect(normalizeSettings({ workspace: ' Mine ' }).workspace).toBe('Mine')
    const workspaces = Array.from({ length: MAX_WORKSPACES + 3 }, (_, i) => ({ name: `w${i}`, layout: {} }))
    const kept = normalizeSettings({ workspaces }).workspaces
    expect(kept).toHaveLength(MAX_WORKSPACES)
    expect(kept[0]!.name).toBe('w3')
  })
})
