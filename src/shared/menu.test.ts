import { describe, expect, it } from 'vitest'
import { appMenu, formatAccelerator, type MenuEntry } from './menu'

/** Every entry, submenus included. */
const flat = (items: MenuEntry[]): MenuEntry[] => items.flatMap((i) => (i.kind === 'submenu' ? [i, ...flat(i.items)] : [i]))

describe('app menu', () => {
  it('has the same sections on every platform, dev items only in dev', () => {
    for (const platform of ['win32', 'darwin', 'linux']) {
      expect(appMenu(platform, false).map((s) => s.label)).toEqual(['File', 'Edit', 'View', 'Help'])
    }
    const labels = (dev: boolean): string[] =>
      appMenu('win32', dev).flatMap((s) => flat(s.items).flatMap((i) => (i.kind === 'separator' ? [] : [i.label])))
    expect(labels(false)).not.toContain('Toggle Developer Tools')
    expect(labels(true)).toContain('Toggle Developer Tools')
  })

  it('never binds one shortcut twice', () => {
    for (const platform of ['win32', 'darwin']) {
      const keys = appMenu(platform, true).flatMap((s) => flat(s.items).flatMap((i) => ('accelerator' in i && i.accelerator ? [i.accelerator] : [])))
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it('lists every theme in View › Theme', () => {
    const view = appMenu('win32', false).find((s) => s.label === 'View')!
    const theme = view.items.find((i) => i.kind === 'submenu' && i.label === 'Theme')
    expect(theme?.kind === 'submenu' && theme.items.map((i) => (i.kind === 'command' ? i.command : null))).toEqual([
      'theme-dark',
      'theme-night',
      'theme-light',
      'theme-matrix',
      'theme-retro'
    ])
  })

  it('switches the view mode from the View menu', () => {
    const view = appMenu('win32', false).find((s) => s.label === 'View')!
    const commands = view.items.flatMap((i) => (i.kind === 'command' ? [i.command] : []))
    expect(commands).toEqual(expect.arrayContaining(['view-2d', 'view-split', 'view-3d']))
  })

  it('lists every 3D look and Custom in View › 3D Look', () => {
    const view = appMenu('win32', false).find((s) => s.label === 'View')!
    const looks = view.items.find((i) => i.kind === 'submenu' && i.label === '3D Look')
    expect(looks?.kind === 'submenu' && looks.items.map((i) => (i.kind === 'command' ? i.command : null))).toEqual([
      'look-lit',
      'look-unlit',
      'look-wireframe',
      'look-unlit-wire',
      'look-clay',
      'look-normals',
      'look-psx',
      'look-n64',
      'look-custom'
    ])
  })

  it('formats shortcuts per platform', () => {
    expect(formatAccelerator('CmdOrCtrl+Shift+P', 'win32')).toBe('Ctrl+Shift+P')
    expect(formatAccelerator('CmdOrCtrl+\\', 'linux')).toBe('Ctrl+\\')
    expect(formatAccelerator('CmdOrCtrl+Shift+P', 'darwin')).toBe('⌘⇧P')
    expect(formatAccelerator('Alt+F4', 'win32')).toBe('Alt+F4')
  })
})
