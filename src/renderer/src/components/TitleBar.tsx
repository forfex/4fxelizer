import { useEffect, useRef } from 'react'
import { Menubar } from 'radix-ui'
import { appMenu, formatAccelerator, type MenuEntry } from '@shared/menu'
import { runMenuCommand } from '@/actions'
import iconUrl from '@/assets/icon.svg'
import { cssColor } from '@/lib/pixelSnap'
import { cn } from '@/lib/utils'
import { useApp } from '@/store'
import { MENU_CONTENT_CLASS, MENU_ITEM_CLASS, MENU_SEPARATOR_CLASS } from './ui/menu'

const platform = window.fx.platform
const isMac = platform === 'darwin'
const MENU = appMenu(platform, import.meta.env.DEV)

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
  const imageName = useApp((s) => s.image?.name ?? null)
  const title = imageName ? `${imageName} — 4FXELIZER` : '4FXELIZER'

  useEffect(() => {
    document.title = title
  }, [title])

  useEffect(() => {
    const height = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fx-titlebar-height')) || 32
    window.fx.setTitleBarOverlay({ color: tokenRgb('--fx-titlebar-bg'), symbolColor: tokenRgb('--fx-titlebar-symbol'), height })
  }, [])

  // Only the icon and the empty area around the title are drag regions. The menus sit outside
  // any drag region: a drag region layered over them (even a click-through one) swallows real
  // mouse clicks, because Windows hit-tests drag regions before the page sees the click.
  return (
    <header
      className={cn('flex h-(--fx-titlebar-height) shrink-0 items-center bg-(--fx-titlebar-bg)', isMac && 'pl-20')}
      // Windows/Linux: clear of the native window buttons (outside the title bar area).
      style={isMac ? undefined : { paddingRight: 'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))' }}
    >
      {!isMac && (
        <>
          <span className="flex h-full shrink-0 items-center px-2 [-webkit-app-region:drag]">
            <img src={iconUrl} alt="" className="size-4" draggable={false} />
          </span>
          <AppMenuBar />
        </>
      )}
      <span className="flex h-full min-w-0 flex-1 items-center justify-center px-4 [-webkit-app-region:drag]">
        <span className="truncate text-small text-(--fx-titlebar-text)">{title}</span>
      </span>
    </header>
  )
}

/** File / Edit / View / Help, from the same definition as the native menu. */
function AppMenuBar() {
  // Clipboard actions must reach the field that was focused before the menu took focus.
  const lastFocus = useRef<HTMLElement | null>(null)
  const run = (entry: MenuEntry): void => {
    if (entry.kind === 'command') runMenuCommand(entry.command)
    else if (entry.kind === 'role') {
      lastFocus.current?.focus()
      window.fx.runMenuRole(entry.role)
    }
  }
  return (
    <Menubar.Root
      className="flex h-full shrink-0 items-center [-webkit-app-region:no-drag]"
      onValueChange={(value) => {
        if (value && !lastFocus.current) lastFocus.current = document.activeElement as HTMLElement | null
        if (!value) lastFocus.current = null
      }}
    >
      {MENU.map((section) => (
        <Menubar.Menu key={section.label}>
          <Menubar.Trigger
            className={cn(
              'flex h-6 cursor-default items-center rounded-fx px-2 outline-none select-none',
              'hover:bg-panel-hi data-[state=open]:bg-accent data-[state=open]:text-accent-text',
              'focus-visible:outline-px focus-visible:outline-dotted focus-visible:outline-accent'
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
              {section.items.map((entry, i) =>
                entry.kind === 'separator' ? (
                  <Menubar.Separator key={i} className={MENU_SEPARATOR_CLASS} />
                ) : (
                  <Menubar.Item key={entry.label} className={MENU_ITEM_CLASS} onSelect={() => run(entry)}>
                    {entry.label}
                    {entry.accelerator && (
                      <span className="ml-auto pl-6 font-mono text-small opacity-70">{formatAccelerator(entry.accelerator, platform)}</span>
                    )}
                  </Menubar.Item>
                )
              )}
            </Menubar.Content>
          </Menubar.Portal>
        </Menubar.Menu>
      ))}
    </Menubar.Root>
  )
}
