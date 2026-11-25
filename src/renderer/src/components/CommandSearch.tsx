// Help › Search Commands (Ctrl/Cmd+K): every menu command, the panels and the built-in presets in
// one filtered list. Type to filter, arrows to move, Enter to run, Escape to close.

import { useEffect, useMemo, useRef, useState } from 'react'
import { filterItems, menuItems, type MenuAction, type SearchItem } from '@shared/commandSearch'
import { appMenu, formatAccelerator } from '@shared/menu'
import { loadBuiltinPreset, runMenuCommand } from '@/actions'
import { cn } from '@/lib/utils'
import { useSavedSettings } from '@/settings'
import { BUILTIN_PRESETS, PRESET_CATEGORIES, type BuiltinPreset } from '@/stack/builtinPresets'
import { useApp } from '@/store'
import { PANELS, revealPanel } from '@/workspace/workspace'
import { INPUT_CLASS } from './ui/controls'
import { Dialog, DialogContent } from './ui/dialog'
import { MENU_ITEM_CLASS } from './ui/menu'

const platform = window.fx.platform

type Action = MenuAction | { kind: 'panel'; id: string } | { kind: 'preset'; preset: BuiltinPreset }

function run(action: Action): void {
  switch (action.kind) {
    case 'command': return runMenuCommand(action.command)
    case 'role': return window.fx.runMenuRole(action.role)
    case 'panel': return revealPanel(action.id)
    case 'preset': return loadBuiltinPreset(action.preset)
  }
}

export function CommandSearch() {
  const open = useApp((s) => s.commandSearchOpen)
  const setOpen = useApp((s) => s.setCommandSearchOpen)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title="Search commands" className="top-[18%] w-[min(560px,90vw)] translate-y-0" bodyClassName="flex flex-col gap-2 p-2">
        {open && <SearchBody onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function SearchBody({ onDone }: { onDone(): void }) {
  const { keybinds, recentFiles } = useSavedSettings()
  const items = useMemo((): SearchItem<Action>[] => {
    const menu = menuItems(appMenu(platform, import.meta.env.DEV, keybinds, recentFiles)).filter(
      // Searching for the search itself is no use, and panels are shown (below) rather than toggled.
      (i) => !(i.value.kind === 'command' && (i.value.command === 'command-search' || i.value.command.startsWith('panel-')))
    )
    const panels = PANELS.map((p): SearchItem<Action> => ({ label: `${p.title} Panel`, path: 'Window › Show', value: { kind: 'panel', id: p.id } }))
    const presets = BUILTIN_PRESETS.map(
      (preset): SearchItem<Action> => ({
        label: preset.name,
        path: ['Preset', PRESET_CATEGORIES.find((c) => c.id === preset.category)?.label].filter(Boolean).join(' · '),
        value: { kind: 'preset', preset }
      })
    )
    return [...menu, ...panels, ...presets]
  }, [keybinds, recentFiles])
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const results = useMemo(() => filterItems(items, query), [items, query])
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => setActive(0), [query])
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = (item: SearchItem<Action> | undefined): void => {
    if (!item) return
    onDone()
    // After the dialog has closed, so a command that opens another dialog isn't closed with it.
    setTimeout(() => run(item.value), 0)
  }

  return (
    <>
      <input
        autoFocus
        className={INPUT_CLASS}
        placeholder="Type a command, panel or preset…"
        aria-label="Search commands"
        role="combobox"
        aria-expanded
        aria-controls="command-search-list"
        aria-activedescendant={results.length ? `command-search-${active}` : undefined}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            const step = e.key === 'ArrowDown' ? 1 : -1
            if (results.length) setActive((a) => (a + step + results.length) % results.length)
          } else if (e.key === 'Enter') {
            e.preventDefault()
            choose(results[active])
          }
        }}
      />
      <div ref={listRef} id="command-search-list" role="listbox" className="flex max-h-[50vh] flex-col overflow-y-auto">
        {results.length === 0 && <p className="px-2 py-3 text-dim">Nothing matches “{query.trim()}”.</p>}
        {results.map((item, i) => (
          <div
            key={`${item.path}/${item.label}`}
            id={`command-search-${i}`}
            data-index={i}
            role="option"
            aria-selected={i === active}
            data-highlighted={i === active ? '' : undefined}
            className={cn(MENU_ITEM_CLASS, 'shrink-0 gap-2 pl-2')}
            onPointerMove={() => setActive(i)}
            onClick={() => choose(item)}
          >
            <span className="min-w-0 truncate">{item.label}</span>
            <span className="min-w-0 flex-1 truncate text-small text-dim">{item.path}</span>
            {item.accelerator && <kbd className="shrink-0 font-mono text-[10px] leading-3.5 text-dim">{formatAccelerator(item.accelerator, platform)}</kbd>}
          </div>
        ))}
      </div>
    </>
  )
}
