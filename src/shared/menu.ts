// The app menu, defined once. Main builds the native menu from it (keyboard shortcuts everywhere,
// the menu bar on macOS); the renderer draws it in the custom title bar on Windows and Linux.

import type { MenuCommand } from './api'

/** Actions main performs itself (clipboard, window, dev tools). */
export type MenuRole = 'cut' | 'copy' | 'paste' | 'selectAll' | 'togglefullscreen' | 'quit' | 'close' | 'reload' | 'toggleDevTools'

export type MenuEntry =
  | { kind: 'command'; label: string; command: MenuCommand; accelerator?: string }
  | { kind: 'role'; label: string; role: MenuRole; accelerator?: string }
  | { kind: 'separator' }

export interface MenuSection {
  label: string
  items: MenuEntry[]
}

const command = (label: string, cmd: MenuCommand, accelerator?: string): MenuEntry => ({ kind: 'command', label, command: cmd, accelerator })
const role = (label: string, r: MenuRole, accelerator?: string): MenuEntry => ({ kind: 'role', label, role: r, accelerator })
const separator: MenuEntry = { kind: 'separator' }

export function appMenu(platform: string, isDev: boolean): MenuSection[] {
  const isMac = platform === 'darwin'
  return [
    {
      label: 'File',
      items: [
        command('Open Image…', 'open', 'CmdOrCtrl+O'),
        command('Export…', 'export', 'CmdOrCtrl+E'),
        separator,
        command('Import Palette…', 'import-palette'),
        separator,
        command('Presets…', 'presets', 'CmdOrCtrl+Shift+P'),
        command('Import Preset…', 'import-preset'),
        separator,
        isMac ? role('Close Window', 'close', 'Cmd+W') : role('Exit', 'quit', platform === 'win32' ? 'Alt+F4' : 'Ctrl+Q')
      ]
    },
    {
      label: 'Edit',
      items: [
        // Undo/redo go to the stage stack; the renderer falls back to text undo inside text fields.
        command('Undo', 'undo', 'CmdOrCtrl+Z'),
        command('Redo', 'redo', isMac ? 'Shift+Cmd+Z' : 'Ctrl+Y'),
        separator,
        role('Cut', 'cut', 'CmdOrCtrl+X'),
        role('Copy', 'copy', 'CmdOrCtrl+C'),
        role('Paste', 'paste', 'CmdOrCtrl+V'),
        role('Select All', 'selectAll', 'CmdOrCtrl+A')
      ]
    },
    {
      label: 'View',
      items: [
        command('Fit to Window', 'zoom-fit', 'CmdOrCtrl+0'),
        command('Actual Pixels', 'zoom-actual', 'CmdOrCtrl+1'),
        command('Zoom In', 'zoom-in', 'CmdOrCtrl+='),
        command('Zoom Out', 'zoom-out', 'CmdOrCtrl+-'),
        separator,
        command('Pixel Grid', 'toggle-grid', 'CmdOrCtrl+G'),
        command('Split View', 'toggle-split', 'CmdOrCtrl+\\'),
        separator,
        role('Toggle Full Screen', 'togglefullscreen', isMac ? 'Ctrl+Cmd+F' : 'F11'),
        ...(isDev ? [separator, role('Reload', 'reload', 'CmdOrCtrl+R'), role('Toggle Developer Tools', 'toggleDevTools', isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I')] : [])
      ]
    },
    {
      label: 'Help',
      items: [command('GPU Diagnostics…', 'gpu-diagnostics')]
    }
  ]
}

/** Accelerator as shown in a menu: "CmdOrCtrl+Shift+P" → "Ctrl+Shift+P" (or "⇧⌘P" on macOS). */
export function formatAccelerator(accelerator: string, platform: string): string {
  const isMac = platform === 'darwin'
  const parts = accelerator.split('+')
  if (!isMac) return parts.map((p) => (p === 'CmdOrCtrl' || p === 'Cmd' ? 'Ctrl' : p)).join('+')
  const symbols: Record<string, string> = { CmdOrCtrl: '⌘', Cmd: '⌘', Ctrl: '⌃', Shift: '⇧', Alt: '⌥' }
  return parts.map((p) => symbols[p] ?? p).join('')
}
