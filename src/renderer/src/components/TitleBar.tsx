import { useEffect, useMemo, useRef, useState } from 'react'
import { Menubar } from 'radix-ui'
import { useShallow } from 'zustand/react/shallow'
import type { MenuCommand } from '@shared/api'
import { appMenu, formatAccelerator, type MenuEntry } from '@shared/menu'
import { runMenuCommand } from '@/actions'
import iconUrl from '@/assets/icon.svg'
import { cssColor } from '@/lib/pixelSnap'
import { cn } from '@/lib/utils'
import { useSavedSettings } from '@/settings'
import { useApp } from '@/store'
import { CAPTURE_KEYS_ATTR } from './settings/Keybinds'
import { CaretIcon } from './ui/icons'
import { MENU_CONTENT_CLASS, MENU_ITEM_CLASS, MENU_MARK_CLASS, MENU_SEPARATOR_CLASS } from './ui/menu'

const platform = window.fx.platform
const isMac = platform === 'darwin'

/** CSS color token → "rgb(r g b)" for Electron's title bar overlay. */
function tokenRgb(token: string): string {
  const [r, g, b] = cssColor(token).map((v) => Math.round(v * 255))
  return `rgb(${r}, ${g}, ${b})`
}

/**
 * The window's title bar, drawn by the app: icon, menus and the document title. It's a drag
 * region (move, double-click to maximize). On Windows/Linux the native window buttons sit over
 * its right end, colored from the theme; on macOS the traffic lights sit at its left and the
 * menus stay in the system menu bar.
 */
export function TitleBar() {
  const header = useRef<HTMLElement>(null)
  const imageName = useApp((s) => s.image?.name ?? null)
  const theme = useApp((s) => s.theme)
  const uiScale = useSavedSettings().uiScale
  const title = imageName ? `${imageName} — 4FXELIZER` : '4FXELIZER'

  useEffect(() => {
    document.title = title
  }, [title])

  useEffect(() => {
    // The rendered height, so the token may use any CSS unit; the overlay is sized in unzoomed pixels.
    const height = (header.current?.getBoundingClientRect().height || 32) * uiScale
    window.fx.setTitleBarOverlay({ color: tokenRgb('--fx-titlebar-bg'), symbolColor: tokenRgb('--fx-titlebar-symbol'), height })
  }, [theme, uiScale])

  // Only the icon and the empty area around the title are drag regions. The menus sit outside
  // any drag region: a drag region layered over them (even a click-through one) swallows real
  // mouse clicks, because Windows hit-tests drag regions before the page sees the click.
  return (
    <header
      ref={header}
      className="flex h-(--fx-titlebar-height) shrink-0 items-center border-b-px border-edge bg-(--fx-titlebar-bg)"
      // Windows/Linux: clear of the native window buttons (outside the title bar area).
      style={isMac ? undefined : { paddingRight: 'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))' }}
    >
      {isMac && <span className="h-full w-(--fx-titlebar-mac-inset) shrink-0 [-webkit-app-region:drag]" />}
      {!isMac && (
        <>
          <span className="flex h-full w-9 shrink-0 items-center justify-center [-webkit-app-region:drag]">
            <img src={iconUrl} alt="" className="size-4" draggable={false} />
          </span>
          <AppMenuBar />
        </>
      )}
      <span className="flex h-full min-w-0 flex-1 items-center justify-center px-4 [-webkit-app-region:drag]">
        <span className="truncate text-[12px] leading-4 font-medium text-(--fx-titlebar-text)">
          {imageName && `${imageName} — `}
          <b className="font-display font-bold tracking-[0.08em] text-(--fx-titlebar-symbol)">4FXELIZER</b>
        </span>
      </span>
    </header>
  )
}

/**
 * File / Edit / View / Help, from the same definition as the native menu. Keyboard access like a
 * native menu bar: Alt or F10 focuses it, Alt+letter opens that menu.
 */
function AppMenuBar() {
  const root = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState('')
  const keybinds = useSavedSettings().keybinds
  const menu = useMemo(() => appMenu(platform, import.meta.env.DEV, keybinds), [keybinds])
  const menuRef = useRef(menu)
  menuRef.current = menu
  // Commands that are on/off states show the selected mark in the menu.
  const checked = useApp(
    useShallow((s): Partial<Record<MenuCommand, boolean>> => ({
      'toggle-grid': s.grid,
      'toggle-split': s.split,
      'toggle-tile': s.tile,
      'toggle-live-reload': s.liveReload,
      [`theme-${s.theme}`]: true,
      [`view-${s.viewMode}`]: true
    }))
  )
  // Clipboard actions must reach the field that was focused before the menu took focus. Recorded
  // before Radix moves focus (pointer down, or the keyboard shortcuts below).
  const lastFocus = useRef<HTMLElement | null>(null)
  const remember = (): void => {
    const active = document.activeElement as HTMLElement | null
    if (!root.current?.contains(active)) lastFocus.current = active
  }

  useEffect(() => {
    let altAlone = false
    const firstTrigger = (): HTMLElement | null => root.current?.querySelector('button') ?? null
    // A shortcut being recorded in Settings takes every key, Alt and F10 included.
    const captured = (e: KeyboardEvent): boolean => !!(e.target as Element | null)?.closest?.(`[${CAPTURE_KEYS_ATTR}]`)
    const onKeyDown = (e: KeyboardEvent): void => {
      if (captured(e)) {
        altAlone = false
        return
      }
      altAlone = e.key === 'Alt' && !e.ctrlKey && !e.shiftKey && !e.metaKey
      if (e.key === 'F10' && !e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
        e.preventDefault()
        remember()
        firstTrigger()?.focus()
      } else if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.length === 1) {
        const section = menuRef.current.find((m) => m.label[0]!.toLowerCase() === e.key.toLowerCase())
        if (section) {
          e.preventDefault()
          remember()
          setOpen(section.label)
        }
      }
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key !== 'Alt' || !altAlone) return
      altAlone = false
      if (root.current?.contains(document.activeElement)) return
      remember()
      firstTrigger()?.focus()
    }
    // Alt held for a click (the eyedropper) or another shortcut isn't an Alt press on its own.
    const cancel = (): void => {
      altAlone = false
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('pointerdown', cancel, true)
    window.addEventListener('blur', cancel)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('pointerdown', cancel, true)
      window.removeEventListener('blur', cancel)
    }
  }, [])

  const run = (entry: MenuEntry): void => {
    if (entry.kind === 'command') runMenuCommand(entry.command)
    else if (entry.kind === 'role') {
      lastFocus.current?.focus()
      window.fx.runMenuRole(entry.role)
    }
  }
  const renderEntry = (entry: MenuEntry, i: number): React.ReactNode => {
    if (entry.kind === 'separator') return <Menubar.Separator key={i} className={MENU_SEPARATOR_CLASS} />
    if (entry.kind === 'submenu') {
      return (
        <Menubar.Sub key={entry.label}>
          <Menubar.SubTrigger className={cn(MENU_ITEM_CLASS, 'data-[state=open]:bg-accent-soft')}>
            {entry.label}
            <CaretIcon open={false} className="ml-auto text-dim" />
          </Menubar.SubTrigger>
          <Menubar.Portal>
            <Menubar.SubContent sideOffset={4} className={cn(MENU_CONTENT_CLASS, 'min-w-40')}>
              {entry.items.map(renderEntry)}
            </Menubar.SubContent>
          </Menubar.Portal>
        </Menubar.Sub>
      )
    }
    return (
      <Menubar.Item key={entry.label} className={MENU_ITEM_CLASS} onSelect={() => run(entry)}>
        {entry.kind === 'command' && checked[entry.command] && <span className={MENU_MARK_CLASS} />}
        {entry.label}
        {entry.accelerator && (
          <kbd className="ml-auto pl-6 font-mono text-[10px] leading-3.5 text-dim">{formatAccelerator(entry.accelerator, platform)}</kbd>
        )}
      </Menubar.Item>
    )
  }

  return (
    <Menubar.Root
      ref={root}
      className="flex h-full shrink-0 items-center [-webkit-app-region:no-drag]"
      value={open}
      onValueChange={setOpen}
      // Menu items are portalled but still bubble through here in React; only presses on the bar count.
      onPointerDownCapture={(e) => root.current?.contains(e.target as Node) && remember()}
      // Escape on a focused (closed) menu button hands focus back, like leaving a native menu bar.
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || open) return
        lastFocus.current?.focus()
        if (root.current?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur()
      }}
    >
      {menu.map((section) => (
        <Menubar.Menu key={section.label} value={section.label}>
          <Menubar.Trigger
            className={cn(
              'flex h-6 cursor-default items-center rounded-fx px-2 text-(--fx-titlebar-symbol) outline-none select-none',
              // A tint of the title bar's own text color, so it reads on any title-bar ground.
              'hover:bg-(--fx-titlebar-hover) data-[state=open]:bg-(--fx-titlebar-hover) focus-visible:ring-focus'
            )}
          >
            {section.label}
          </Menubar.Trigger>
          <Menubar.Portal>
            <Menubar.Content
              align="start"
              sideOffset={2}
              className={cn(MENU_CONTENT_CLASS, 'min-w-56')}
              // Hand focus back to what had it (a text field, the viewer) instead of the menu button.
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              {section.items.map((entry, i) => renderEntry(entry, i))}
            </Menubar.Content>
          </Menubar.Portal>
        </Menubar.Menu>
      ))}
    </Menubar.Root>
  )
}
