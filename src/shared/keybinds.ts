// Keyboard shortcuts the user can change: one per menu command, stored as overrides of the
// accelerators in the shared menu (UserSettings.keybinds; '' = no shortcut). Main builds the native
// menu with them, so they work everywhere the default ones did.

import type { Keybinds, MenuCommand } from './api'
import { appMenu, type MenuEntry, type MenuSection } from './menu'

export interface BindableCommand {
  command: MenuCommand
  /** "Open Textures", "Theme: Dark". */
  label: string
  /** Menu it sits in ("File", "View", …). */
  group: string
  /** Accelerator in the default menu ('' = none). */
  defaultAccelerator: string
}

const plain = (label: string): string => label.replace(/…$/, '')

/** Every menu command, in menu order, with its default shortcut. */
export function bindableCommands(platform: string): BindableCommand[] {
  const out: BindableCommand[] = []
  const walk = (entries: MenuEntry[], group: string, prefix: string): void => {
    for (const entry of entries) {
      if (entry.kind === 'submenu') walk(entry.items, group, `${prefix}${entry.label}: `)
      else if (entry.kind === 'command') {
        out.push({ command: entry.command, label: prefix + plain(entry.label), group, defaultAccelerator: entry.accelerator ?? '' })
      }
    }
  }
  for (const section of appMenu(platform, false)) walk(section.items, section.label, '')
  return out
}

/** The shortcut a command has now ('' = none). */
export function acceleratorOf(command: MenuCommand, keybinds: Keybinds, platform: string): string {
  const override = keybinds[command]
  if (override !== undefined) return override
  return bindableCommands(platform).find((c) => c.command === command)?.defaultAccelerator ?? ''
}

const MODIFIER_ORDER = ['CmdOrCtrl', 'Ctrl', 'Alt', 'Shift', 'Super']

/**
 * One spelling per shortcut, for comparing them: "Shift+Cmd+Z" and "CmdOrCtrl+Shift+Z" are the
 * same keys on macOS, "Ctrl+Y" and "CmdOrCtrl+Y" on Windows and Linux.
 */
export function canonicalAccelerator(accelerator: string, platform: string): string {
  if (!accelerator) return ''
  const isMac = platform === 'darwin'
  const parts = accelerator.split('+')
  const key = parts.pop()!
  const mods = new Set<string>()
  for (const p of parts) {
    const m = p.toLowerCase()
    if (m === 'cmdorctrl' || m === 'commandorcontrol' || m === 'cmd' || m === 'command') mods.add('CmdOrCtrl')
    else if (m === 'ctrl' || m === 'control') mods.add(isMac ? 'Ctrl' : 'CmdOrCtrl')
    else if (m === 'alt' || m === 'option' || m === 'altgr') mods.add('Alt')
    else if (m === 'shift') mods.add('Shift')
    else if (m === 'super' || m === 'meta') mods.add('Super')
  }
  const k = key.length === 1 ? key.toUpperCase() : key === 'Return' ? 'Enter' : key === 'Esc' ? 'Escape' : key
  return [...MODIFIER_ORDER.filter((m) => mods.has(m)), k].join('+')
}

/** The parts of a KeyboardEvent a shortcut is made from. */
export interface KeyStroke {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/** Keys named by their position (KeyboardEvent.code), as Electron spells them. */
const CODE_KEYS: Record<string, string> = {
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
  NumpadDecimal: 'numdec'
}

const MODIFIER_KEYS = ['Control', 'Shift', 'Alt', 'AltGraph', 'Meta', 'OS']

function keyName(e: KeyStroke): string | null {
  // Letters by the character (what Electron matches), falling back to the position when a
  // modifier changed the character.
  if (/^[a-z]$/i.test(e.key)) return e.key.toUpperCase()
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3)
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5)
  if (/^Numpad\d$/.test(e.code)) return `num${e.code.slice(6)}`
  if (/^F([1-9]|1\d|2[0-4])$/.test(e.key)) return e.key
  return CODE_KEYS[e.code] ?? null
}

export type StrokeResult = { accelerator: string } | { error: string }

/**
 * The shortcut a key press makes, or why it can't be one; null while only modifiers are held.
 * A shortcut needs Ctrl/Cmd or Alt (or is a function key), so it never swallows typing.
 */
export function acceleratorFromKey(e: KeyStroke, platform: string): StrokeResult | null {
  if (MODIFIER_KEYS.includes(e.key)) return null
  const isMac = platform === 'darwin'
  if (!isMac && e.metaKey) return { error: 'The Windows/Super key belongs to the system.' }
  const key = keyName(e)
  if (!key) return { error: `“${e.key}” can’t be used in a shortcut.` }
  const mods: string[] = []
  if (isMac ? e.metaKey : e.ctrlKey) mods.push('CmdOrCtrl')
  if (isMac && e.ctrlKey) mods.push('Ctrl')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  const functionKey = /^F\d+$/.test(key)
  if (!functionKey && !mods.some((m) => m !== 'Shift')) {
    return { error: `Add ${isMac ? '⌘, ⌃' : 'Ctrl'} or ${isMac ? '⌥' : 'Alt'}: shortcuts without them would get in the way of typing.` }
  }
  return { accelerator: [...mods, key].join('+') }
}

/**
 * Shortcuts that aren't free: clipboard and window actions of the menu, the menu bar's own keys
 * and the system's. Returns what uses it, or null.
 */
export function reservedBy(accelerator: string, platform: string): string | null {
  const target = canonicalAccelerator(accelerator, platform)
  const isMac = platform === 'darwin'
  const fixed: [string, string][] = []
  const walk = (entries: MenuEntry[]): void => {
    for (const e of entries) {
      if (e.kind === 'submenu') walk(e.items)
      else if (e.kind === 'role' && e.accelerator) fixed.push([e.accelerator, plain(e.label)])
    }
  }
  const menu: MenuSection[] = appMenu(platform, true)
  for (const section of menu) walk(section.items)
  if (isMac) {
    fixed.push(['Cmd+Q', 'Quit'], ['Cmd+H', 'Hide'], ['Cmd+Alt+H', 'Hide Others'], ['Cmd+M', 'Minimize'])
  } else {
    fixed.push(['F10', 'Menu bar'], ['Ctrl+Shift+Z', 'Redo'], ['Alt+F4', 'Close window'])
    // Alt + a menu's first letter opens that menu.
    for (const section of menu) fixed.push([`Alt+${section.label[0]}`, `${section.label} menu`])
  }
  return fixed.find(([a]) => canonicalAccelerator(a, platform) === target)?.[1] ?? null
}

/** Commands whose current shortcut is `accelerator`. */
export function commandsWith(accelerator: string, keybinds: Keybinds, platform: string): MenuCommand[] {
  const target = canonicalAccelerator(accelerator, platform)
  if (!target) return []
  return bindableCommands(platform)
    .filter((c) => canonicalAccelerator(acceleratorOf(c.command, keybinds, platform), platform) === target)
    .map((c) => c.command)
}

/**
 * Gives `command` the shortcut `accelerator` ('' = none). Other commands that had it lose theirs
 * (listed in `unbound`), so a shortcut always runs one command. Overrides equal to the default
 * are dropped.
 */
export function assignKeybind(
  keybinds: Keybinds,
  command: MenuCommand,
  accelerator: string,
  platform: string
): { keybinds: Keybinds; unbound: MenuCommand[] } {
  const defaults = new Map(bindableCommands(platform).map((c) => [c.command, c.defaultAccelerator]))
  const next: Keybinds = { ...keybinds }
  const set = (cmd: MenuCommand, acc: string): void => {
    if (canonicalAccelerator(acc, platform) === canonicalAccelerator(defaults.get(cmd) ?? '', platform)) delete next[cmd]
    else next[cmd] = acc
  }
  const unbound = accelerator ? commandsWith(accelerator, keybinds, platform).filter((c) => c !== command) : []
  for (const other of unbound) set(other, '')
  set(command, accelerator)
  return { keybinds: next, unbound }
}
