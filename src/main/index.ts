import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { IPC, type FileFilter, type MainGpuInfo, type PresetEntry, type RendererGpuReport } from '@shared/api'
import { applyGpuFlags } from './gpuFlags'
import { buildMenu } from './menu'
import { presetPath, presetsDir, PRESET_SUFFIX } from './presets'
import { getSettings, savedWindowBounds, trackWindow, updateSettings } from './settings'

const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL
const gpuFlags = applyGpuFlags()

// `--gpu-report[=path]` (or FXELIZER_GPU_REPORT=1|path): open a hidden window, collect WebGPU
// diagnostics, write them as JSON, print them to stdout and quit. Used to verify each OS/driver.
const reportArg = process.argv.find((a) => a.startsWith('--gpu-report'))
const reportEnv = process.env.FXELIZER_GPU_REPORT
const gpuReportPath =
  reportArg || reportEnv
    ? resolve(
        reportArg?.split('=')[1] ||
          (reportEnv && reportEnv !== '1' ? reportEnv : '') ||
          '4fxelizer-gpu-report.json'
      )
    : null

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tga']

async function getGpuInfo(): Promise<MainGpuInfo> {
  return {
    platform: process.platform,
    arch: process.arch,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node
    },
    commandLineFlags: gpuFlags,
    featureStatus: app.getGPUFeatureStatus() as unknown as Record<string, string>,
    gpuInfo: await app.getGPUInfo('basic').catch((e: Error) => ({ error: e.message }))
  }
}

async function openFile(win: BrowserWindow, filters: FileFilter[]) {
  const result = await dialog.showOpenDialog(win, { properties: ['openFile'], filters })
  const path = result.filePaths[0]
  if (result.canceled || !path) return null
  return { name: basename(path), bytes: new Uint8Array(await readFile(path)) }
}

function registerIpc(): void {
  ipcMain.handle(IPC.openImage, (event) =>
    openFile(BrowserWindow.fromWebContents(event.sender)!, [{ name: 'Images', extensions: IMAGE_EXTENSIONS }])
  )

  ipcMain.handle(IPC.openFile, (event, filters: FileFilter[]) =>
    openFile(BrowserWindow.fromWebContents(event.sender)!, filters)
  )

  ipcMain.handle(IPC.saveFile, async (event, defaultName: string, bytes: Uint8Array, filters: FileFilter[]) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    const result = await dialog.showSaveDialog(win, { defaultPath: defaultName, filters })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, bytes)
    return result.filePath
  })

  ipcMain.handle(IPC.presetsList, async (): Promise<PresetEntry[]> => {
    const dir = await presetsDir()
    const files = (await readdir(dir)).filter((f) => f.toLowerCase().endsWith(PRESET_SUFFIX))
    const entries = await Promise.all(
      files.map(async (file) => {
        let name = file.slice(0, -PRESET_SUFFIX.length)
        try {
          const parsed = JSON.parse(await readFile(join(dir, file), 'utf8')) as { name?: unknown }
          if (typeof parsed.name === 'string' && parsed.name.trim()) name = parsed.name
        } catch {
          // Unreadable files still show up by file name; loading them reports the error.
        }
        return { name, file }
      })
    )
    return entries.sort((a, b) => a.name.localeCompare(b.name))
  })
  ipcMain.handle(IPC.presetsRead, async (_e, file: string) => readFile(await presetPath(file), 'utf8'))
  ipcMain.handle(IPC.presetsWrite, async (_e, file: string, json: string) => writeFile(await presetPath(file), json, 'utf8'))
  ipcMain.handle(IPC.presetsDelete, async (_e, file: string) => rm(await presetPath(file), { force: true }))
  ipcMain.handle(IPC.presetsShow, async () => {
    const error = await shell.openPath(await presetsDir())
    if (error) throw new Error(error)
  })

  ipcMain.on(IPC.settingsLoad, (event) => {
    event.returnValue = getSettings()
  })
  ipcMain.on(IPC.settingsSave, (_event, patch: unknown) => updateSettings(patch))

  ipcMain.handle(IPC.gpuInfo, getGpuInfo)

  ipcMain.on(IPC.gpuReport, async (_event, renderer: RendererGpuReport) => {
    if (!gpuReportPath) return
    const report = { generatedAt: new Date().toISOString(), main: await getGpuInfo(), renderer }
    const json = JSON.stringify(report, null, 2)
    await writeFile(gpuReportPath, json)
    process.stdout.write(`${json}\n\nGPU report written to ${gpuReportPath}\n`)
    app.exit(renderer.webgpu && renderer.smokeTest?.ok ? 0 : 1)
  })
}

function loadRenderer(win: BrowserWindow): void {
  const query: Record<string, string> | undefined = gpuReportPath
    ? { mode: 'gpu-report' }
    : undefined
  if (isDev) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL!)
    if (query) url.search = new URLSearchParams(query).toString()
    win.loadURL(url.toString())
  } else {
    win.loadFile(join(import.meta.dirname, '../renderer/index.html'), { query })
  }
}

const MIN_WINDOW = { width: 900, height: 600 }

function createWindow(): void {
  const saved = gpuReportPath ? { maximized: false } : savedWindowBounds(MIN_WINDOW)
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    ...saved.bounds,
    minWidth: MIN_WINDOW.width,
    minHeight: MIN_WINDOW.height,
    show: false,
    title: '4FXELIZER',
    backgroundColor: '#1d1c1a',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true
    }
  })

  if (!gpuReportPath) {
    win.once('ready-to-show', () => {
      if (saved.maximized) win.maximize()
      win.show()
    })
    trackWindow(win)
    Menu.setApplicationMenu(buildMenu(win, isDev))
  }

  // Keep the app on its own page; send external links to the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event) => event.preventDefault())

  loadRenderer(win)
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
