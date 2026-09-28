import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { IPC, type MenuCommand } from '@shared/api'

export function buildMenu(win: BrowserWindow, isDev: boolean): Menu {
  const send = (command: MenuCommand) => () => win.webContents.send(IPC.menuCommand, command)
  const isMac = process.platform === 'darwin'

  const devItems: MenuItemConstructorOptions[] = isDev
    ? [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }]
    : []

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as const] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Image…', accelerator: 'CmdOrCtrl+O', click: send('open') },
        { label: 'Export…', accelerator: 'CmdOrCtrl+E', click: send('export') },
        { type: 'separator' },
        { label: 'Import Palette…', click: send('import-palette') },
        { type: 'separator' },
        { label: 'Presets…', accelerator: 'CmdOrCtrl+Shift+P', click: send('presets') },
        { label: 'Import Preset…', click: send('import-preset') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        // Undo/redo go to the stage stack; the renderer falls back to text undo inside text fields.
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: send('undo') },
        { label: 'Redo', accelerator: isMac ? 'Shift+Cmd+Z' : 'Ctrl+Y', click: send('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Fit to Window', accelerator: 'CmdOrCtrl+0', click: send('zoom-fit') },
        { label: 'Actual Pixels', accelerator: 'CmdOrCtrl+1', click: send('zoom-actual') },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: send('zoom-in') },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: send('zoom-out') },
        { type: 'separator' },
        { label: 'Pixel Grid', accelerator: 'CmdOrCtrl+G', click: send('toggle-grid') },
        { label: 'Split View', accelerator: 'CmdOrCtrl+\\', click: send('toggle-split') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...devItems
      ]
    },
    {
      label: 'Help',
      submenu: [{ label: 'GPU Diagnostics…', click: send('gpu-diagnostics') }]
    }
  ]
  return Menu.buildFromTemplate(template)
}
