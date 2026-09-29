import { describe, expect, it } from 'vitest'
import { MENU_COMMANDS } from './api'
import { acceleratorFromKey, acceleratorOf, assignKeybind, bindableCommands, canonicalAccelerator, commandsWith, reservedBy, type KeyStroke } from './keybinds'
import { appMenu, type MenuEntry } from './menu'

const stroke = (key: string, code: string, mods: Partial<KeyStroke> = {}): KeyStroke => ({
  key,
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods
})

describe('keybinds', () => {
  it('lists every menu command once, with its default shortcut', () => {
    for (const platform of ['win32', 'darwin', 'linux']) {
      const commands = bindableCommands(platform).map((c) => c.command)
      expect(new Set(commands).size).toBe(commands.length)
      expect([...commands].sort()).toEqual([...MENU_COMMANDS].sort())
    }
    const open = bindableCommands('win32').find((c) => c.command === 'open')!
    expect(open).toEqual({ command: 'open', label: 'Open Textures', group: 'File', defaultAccelerator: 'CmdOrCtrl+O' })
    expect(bindableCommands('win32').find((c) => c.command === 'theme-dark')!.label).toBe('Theme: Dark')
  })

  it('puts overrides into the menu, empty ones removing the shortcut', () => {
    const find = (entries: MenuEntry[], cmd: string): MenuEntry | undefined =>
      entries.flatMap((e) => (e.kind === 'submenu' ? e.items : [e])).find((e) => e.kind === 'command' && e.command === cmd)
    const items = appMenu('win32', false, { open: 'Alt+O', export: '', 'theme-night': 'F6' }).flatMap((s) => s.items)
    expect(find(items, 'open')).toMatchObject({ accelerator: 'Alt+O' })
    expect(find(items, 'export')).toMatchObject({ accelerator: undefined })
    expect(find(items, 'theme-night')).toMatchObject({ accelerator: 'F6' })
    expect(find(items, 'undo')).toMatchObject({ accelerator: 'CmdOrCtrl+Z' })
  })

  it('compares shortcuts however they are spelled', () => {
    expect(canonicalAccelerator('Ctrl+Y', 'win32')).toBe(canonicalAccelerator('CmdOrCtrl+y', 'win32'))
    expect(canonicalAccelerator('Shift+Cmd+Z', 'darwin')).toBe('CmdOrCtrl+Shift+Z')
    expect(canonicalAccelerator('Ctrl+Z', 'darwin')).not.toBe(canonicalAccelerator('Cmd+Z', 'darwin'))
    expect(canonicalAccelerator('Option+Return', 'darwin')).toBe('Alt+Enter')
  })

  it('turns key presses into shortcuts', () => {
    expect(acceleratorFromKey(stroke('Control', 'ControlLeft', { ctrlKey: true }), 'win32')).toBeNull()
    expect(acceleratorFromKey(stroke('k', 'KeyK', { ctrlKey: true }), 'win32')).toEqual({ accelerator: 'CmdOrCtrl+K' })
    expect(acceleratorFromKey(stroke('K', 'KeyK', { ctrlKey: true, shiftKey: true }), 'win32')).toEqual({ accelerator: 'CmdOrCtrl+Shift+K' })
    // Shift changes the character; the digit comes from the key's position.
    expect(acceleratorFromKey(stroke('!', 'Digit1', { altKey: true, shiftKey: true }), 'linux')).toEqual({ accelerator: 'Alt+Shift+1' })
    expect(acceleratorFromKey(stroke('F5', 'F5'), 'win32')).toEqual({ accelerator: 'F5' })
    expect(acceleratorFromKey(stroke('ArrowUp', 'ArrowUp', { ctrlKey: true }), 'win32')).toEqual({ accelerator: 'CmdOrCtrl+Up' })
    expect(acceleratorFromKey(stroke('=', 'Equal', { ctrlKey: true }), 'win32')).toEqual({ accelerator: 'CmdOrCtrl+=' })
    expect(acceleratorFromKey(stroke('k', 'KeyK', { metaKey: true, ctrlKey: true }), 'darwin')).toEqual({ accelerator: 'CmdOrCtrl+Ctrl+K' })
  })

  it('refuses shortcuts that would get in the way of typing or belong to the system', () => {
    expect(acceleratorFromKey(stroke('k', 'KeyK'), 'win32')).toHaveProperty('error')
    expect(acceleratorFromKey(stroke('K', 'KeyK', { shiftKey: true }), 'win32')).toHaveProperty('error')
    expect(acceleratorFromKey(stroke('k', 'KeyK', { metaKey: true }), 'win32')).toHaveProperty('error')
  })

  it('knows the shortcuts that are taken by clipboard, window and menu-bar keys', () => {
    expect(reservedBy('Ctrl+C', 'win32')).toBe('Copy')
    expect(reservedBy('F11', 'win32')).toBe('Toggle Full Screen')
    expect(reservedBy('Alt+F', 'win32')).toBe('File menu')
    expect(reservedBy('Alt+F', 'darwin')).toBeNull()
    expect(reservedBy('Cmd+Q', 'darwin')).toBe('Quit')
    expect(reservedBy('CmdOrCtrl+K', 'win32')).toBeNull()
  })

  it('moves a shortcut to the command it is given', () => {
    const { keybinds, unbound } = assignKeybind({}, 'toggle-tile', 'CmdOrCtrl+G', 'win32')
    expect(unbound).toEqual(['toggle-grid'])
    expect(keybinds).toEqual({ 'toggle-tile': 'CmdOrCtrl+G', 'toggle-grid': '' })
    expect(acceleratorOf('toggle-grid', keybinds, 'win32')).toBe('')
    expect(commandsWith('Ctrl+G', keybinds, 'win32')).toEqual(['toggle-tile'])
  })

  it('drops overrides that equal the default', () => {
    const changed = assignKeybind({}, 'open', 'Alt+O', 'win32').keybinds
    expect(changed).toEqual({ open: 'Alt+O' })
    expect(assignKeybind(changed, 'open', 'Ctrl+O', 'win32').keybinds).toEqual({})
    // Resetting takes the default back from a command that was given it.
    const moved = assignKeybind({}, 'open-model', 'CmdOrCtrl+O', 'win32').keybinds
    const reset = assignKeybind(moved, 'open', 'CmdOrCtrl+O', 'win32')
    expect(reset.unbound).toEqual(['open-model'])
    expect(reset.keybinds).toEqual({ 'open-model': '' })
  })
})
