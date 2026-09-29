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
      theme: 'dark',
      exportFormat: 'png-rgba',
      psxCheck: false,
      layout: null,
      workspace: 'essentials',
      workspaces: [],
      view3d: DEFAULT_SETTINGS.view3d,
      bake: DEFAULT_SETTINGS.bake,
      wheel: DEFAULT_SETTINGS.wheel,
      keybinds: {},
      gpu: 'auto',
      uiScale: 1,
      invertZoom: false
    })
    expect(normalizeSettings({ exportFormat: 'tiff' }).exportFormat).toBe('png-indexed')
    for (const f of ['tga-indexed', 'tga-rgba', 'bmp-indexed', 'bmp-rgba']) expect(normalizeSettings({ exportFormat: f }).exportFormat).toBe(f)
    expect(normalizeSettings({ exportFormat: 'bmp-cmyk' }).exportFormat).toBe('png-indexed')
  })

  it('keeps a known theme and falls back to Dark', () => {
    for (const t of ['night', 'light', 'matrix', 'retro']) expect(normalizeSettings({ theme: t }).theme).toBe(t)
    expect(normalizeSettings({ theme: 'sepia' }).theme).toBe('dark')
    expect(normalizeSettings({}).theme).toBe('dark')
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

  it('keeps wheel settings in range', () => {
    expect(normalizeSettings({ wheel: { mode: 'always', delay: 400 } }).wheel).toEqual({ mode: 'always', delay: 400 })
    expect(normalizeSettings({ wheel: { mode: 'spin', delay: 99999 } }).wheel).toEqual({ mode: 'hover', delay: 3000 })
    expect(normalizeSettings({ wheel: 'off' }).wheel).toEqual(DEFAULT_SETTINGS.wheel)
  })

  it('keeps keybinds of known commands only', () => {
    const { keybinds } = normalizeSettings({ keybinds: { open: 'Alt+O', export: '', nope: 'F1', undo: 5, redo: 'Ctrl+<script>' } })
    expect(keybinds).toEqual({ open: 'Alt+O', export: '' })
  })

  it('keeps the GPU preference, interface scale and zoom direction', () => {
    expect(normalizeSettings({ gpu: 'low-power', uiScale: 1.25, invertZoom: true })).toMatchObject({ gpu: 'low-power', uiScale: 1.25, invertZoom: true })
    expect(normalizeSettings({ gpu: 'fastest', uiScale: 1.12 })).toMatchObject({ gpu: 'auto', uiScale: 1.1 })
    expect(normalizeSettings({ uiScale: 'big' }).uiScale).toBe(1)
  })
})
