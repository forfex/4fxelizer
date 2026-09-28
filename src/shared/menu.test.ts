import { describe, expect, it } from 'vitest'
import { appMenu, formatAccelerator } from './menu'

describe('app menu', () => {
  it('has the same sections on every platform, dev items only in dev', () => {
    for (const platform of ['win32', 'darwin', 'linux']) {
      expect(appMenu(platform, false).map((s) => s.label)).toEqual(['File', 'Edit', 'View', 'Help'])
    }
    const labels = (dev: boolean): string[] =>
      appMenu('win32', dev).flatMap((s) => s.items.flatMap((i) => (i.kind === 'separator' ? [] : [i.label])))
    expect(labels(false)).not.toContain('Toggle Developer Tools')
    expect(labels(true)).toContain('Toggle Developer Tools')
  })

  it('never binds one shortcut twice', () => {
    for (const platform of ['win32', 'darwin']) {
      const keys = appMenu(platform, true).flatMap((s) => s.items.flatMap((i) => ('accelerator' in i && i.accelerator ? [i.accelerator] : [])))
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it('formats shortcuts per platform', () => {
    expect(formatAccelerator('CmdOrCtrl+Shift+P', 'win32')).toBe('Ctrl+Shift+P')
    expect(formatAccelerator('CmdOrCtrl+\\', 'linux')).toBe('Ctrl+\\')
    expect(formatAccelerator('CmdOrCtrl+Shift+P', 'darwin')).toBe('⌘⇧P')
    expect(formatAccelerator('Alt+F4', 'win32')).toBe('Alt+F4')
  })
})
