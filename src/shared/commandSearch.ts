// Command search (Help › Search Commands): the app menu flattened into one list, and filtering a
// list by what the user types (substring first, then word starts, then letters in order).

import type { MenuCommand } from './api'
import type { MenuEntry, MenuRole, MenuSection } from './menu'

export interface SearchItem<T> {
  label: string
  /** Where it lives: "View › Theme", "Panel", "Preset · Consoles". */
  path: string
  /** Accelerator in menu spelling ("CmdOrCtrl+K"), if any. */
  accelerator?: string
  value: T
}

export type MenuAction = { kind: 'command'; command: MenuCommand } | { kind: 'role'; role: MenuRole }

/** Roles that act on the focused text field: meaningless from a search box. */
const SKIPPED_ROLES: readonly MenuRole[] = ['cut', 'copy', 'paste', 'selectAll']

const plain = (label: string): string => label.replace(/…$/, '')

/** Every runnable menu item, submenus flattened ("View › Theme" as the path of "Dark"). */
export function menuItems(menu: MenuSection[]): SearchItem<MenuAction>[] {
  const out: SearchItem<MenuAction>[] = []
  const walk = (entries: MenuEntry[], path: string): void => {
    for (const entry of entries) {
      if (entry.kind === 'submenu') walk(entry.items, `${path} › ${entry.label}`)
      else if (entry.kind === 'command') {
        out.push({ label: plain(entry.label), path, accelerator: entry.accelerator, value: { kind: 'command', command: entry.command } })
      } else if (entry.kind === 'role' && !SKIPPED_ROLES.includes(entry.role)) {
        out.push({ label: plain(entry.label), path, accelerator: entry.accelerator, value: { kind: 'role', role: entry.role } })
      }
    }
  }
  for (const section of menu) walk(section.items, section.label)
  return out
}

/**
 * How well `text` matches `query` (lowercase, without extra spaces): higher is better, 0 = no
 * match. A prefix beats the query starting a later word, which beats a substring, which beats
 * every query word starting a word of the text, which beats the query's letters appearing in order.
 */
export function matchScore(text: string, query: string): number {
  const t = text.toLowerCase()
  if (!query) return 1
  if (t.startsWith(query)) return 400
  const at = t.indexOf(query)
  for (let i = at; i > 0; i = t.indexOf(query, i + 1)) if (!/[a-z0-9]/.test(t[i - 1]!)) return 350 - Math.min(i, 49)
  if (at >= 0) return 300 - Math.min(at, 99)
  const words = t.split(/[^a-z0-9]+/).filter(Boolean)
  const queryWords = query.split(' ').filter(Boolean)
  if (queryWords.every((q) => words.some((w) => w.startsWith(q)))) return 200
  let i = 0
  for (const c of t) if (c === query[i]) i++
  return i === query.length ? 100 - Math.min(t.length, 99) / 2 : 0
}

/**
 * The items matching `query`, best first (ties keep their order). The label counts most; the path
 * ("View › Theme") also matches, a little weaker, so "theme" finds every theme.
 */
export function filterItems<T>(items: readonly SearchItem<T>[], query: string): SearchItem<T>[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!q) return [...items]
  return items
    .map((item, index) => ({
      item,
      index,
      score: Math.max(matchScore(item.label, q), matchScore(item.path, q) * 0.9, matchScore(`${item.path} ${item.label}`, q) * 0.8)
    }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((m) => m.item)
}
