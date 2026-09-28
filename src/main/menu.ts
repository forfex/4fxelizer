import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { IPC, type MenuCommand } from '@shared/api'
import { appMenu, type MenuEntry, type MenuRole } from '@shared/menu'

/** Performs a menu role for the in-app menu bar (the native menu uses Electron's roles directly). */
export function runMenuRole(win: BrowserWindow, role: MenuRole): void {
  const wc = win.webContents
  switch (role) {
    case 'cut': return wc.cut()
    case 'copy': return wc.copy()
    case 'paste': return wc.paste()
    case 'selectAll': return wc.selectAll()
    case 'togglefullscreen': return win.setFullScreen(!win.isFullScreen())
    case 'close': return win.close()
    case 'quit': return app.quit()
    case 'reload': return wc.reload()
    case 'toggleDevTools': return wc.toggleDevTools()
  }
}

/**
 * Native menu built from the shared definition. On Windows/Linux it's hidden behind the custom
 * title bar but still provides the keyboard shortcuts; on macOS it's the real menu bar.
 */
export function buildMenu(win: BrowserWindow, isDev: boolean): Menu {
  const send = (command: MenuCommand) => () => win.webContents.send(IPC.menuCommand, command)
  const isMac = process.platform === 'darwin'
  const item = (entry: MenuEntry): MenuItemConstructorOptions => {
    if (entry.kind === 'separator') return { type: 'separator' }
    if (entry.kind === 'submenu') return { label: entry.label, submenu: entry.items.map(item) }
    if (entry.kind === 'role') return { role: entry.role, label: entry.label, accelerator: entry.accelerator }
    return { label: entry.label, accelerator: entry.accelerator, click: send(entry.command) }
  }
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as const] : []),
    ...appMenu(process.platform, isDev).map((section) => ({ label: section.label, submenu: section.items.map(item) }))
  ]
  return Menu.buildFromTemplate(template)
}
