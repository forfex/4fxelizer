import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { IPC, THEME_WINDOW_COLORS, type FileFilter, type MainGpuInfo, type PresetEntry, type RendererGpuReport, type TitleBarOverlay } from '@shared/api'
import { isExportFileName } from '@shared/exportNames'
import { MAP_IMAGE_EXTENSIONS, siblingMaps } from '@shared/maps'
import { isModelFile, isModelResource, MODEL_EXTENSIONS, referenceCandidates } from '@shared/model'
import { baseName, isProjectFile, PROJECT_EXTENSION, type ProjectFileRef } from '@shared/project'
import type { MenuRole } from '@shared/menu'
import { applyGpuFlags } from './gpuFlags'
import { buildMenu, runMenuRole } from './menu'
import { presetPath, presetsDir, PRESET_SUFFIX } from './presets'
import { flushSettings, getSettings, savedWindowBounds, trackWindow, updateSettings } from './settings'
import { FileWatcher } from './watch'

const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL

// FXELIZER_USER_DATA=<dir>: keep settings and presets there (automated runs leave the real ones alone).
if (process.env.FXELIZER_USER_DATA) app.setPath('userData', resolve(process.env.FXELIZER_USER_DATA))
// Read before the app is ready: the GPU switches only apply at startup.
const gpuPreference = getSettings().gpu
const gpuFlags = applyGpuFlags(gpuPreference)

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
    gpuPreference,
    featureStatus: app.getGPUFeatureStatus() as unknown as Record<string, string>,
    gpuInfo: await app.getGPUInfo('basic').catch((e: Error) => ({ error: e.message }))
  }
}

async function openFile(win: BrowserWindow, filters: FileFilter[]) {
  const result = await dialog.showOpenDialog(win, { properties: ['openFile'], filters })
  const path = result.filePaths[0]
  if (result.canceled || !path) return null
  return { name: basename(path), bytes: new Uint8Array(await readFile(path)), path }
}

/** Asks for several files; empty when cancelled. */
async function openFiles(win: BrowserWindow, filters: FileFilter[]) {
  const result = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters })
  if (result.canceled) return []
  return Promise.all(result.filePaths.map(async (path) => ({ name: basename(path), bytes: new Uint8Array(await readFile(path)), path })))
}

/** Most map files read for one texture. */
const MAX_MAP_FILES = 16

/** Map files next to a texture (same base name plus a map suffix such as _ao). */
async function findMaps(texturePath: string) {
  if (typeof texturePath !== 'string' || !texturePath) return []
  const dir = dirname(texturePath)
  const files = await readdir(dir).catch(() => [] as string[])
  const maps = siblingMaps(basename(texturePath), files).slice(0, MAX_MAP_FILES)
  const read = await Promise.all(
    maps.map(async (name) => {
      const path = join(dir, name)
      return readFile(path).then((bytes) => ({ name, bytes: new Uint8Array(bytes), path }), () => null)
    })
  )
  return read.filter((f) => f !== null)
}

/** Largest file a model may pull in (a texture or a glTF buffer). */
const MAX_MODEL_FILE = 512 * 1024 * 1024

/**
 * A file a model refers to, looked up next to the model (see referenceCandidates). Only buffers,
 * material libraries and images are read.
 */
async function readModelFile(modelPath: string, reference: string) {
  if (typeof modelPath !== 'string' || typeof reference !== 'string' || !isAbsolute(modelPath)) return null
  const dir = dirname(modelPath)
  for (const candidate of referenceCandidates(reference)) {
    if (!isModelResource(candidate)) continue
    const path = resolve(dir, candidate)
    try {
      const info = await stat(path)
      if (!info.isFile() || info.size > MAX_MODEL_FILE) continue
      return { name: basename(path), bytes: new Uint8Array(await readFile(path)), path }
    } catch {
      // Not there: try the next place.
    }
  }
  return null
}

const PROJECT_FILTERS: FileFilter[] = [{ name: '4FXELIZER project', extensions: [PROJECT_EXTENSION] }]

const isProjectPath = (path: unknown): path is string => typeof path === 'string' && isAbsolute(path) && isProjectFile(path)

/** Writes a project next to its destination first, so a failed write never leaves half a file. */
async function writeProject(path: unknown, json: unknown): Promise<void> {
  if (!isProjectPath(path) || typeof json !== 'string') throw new Error('Invalid project path')
  const temp = `${path}.saving`
  await writeFile(temp, json, 'utf8')
  await rename(temp, path)
}

/**
 * A texture, map or model a project refers to: at its saved absolute path, else relative to the
 * project (moved together), else by name next to the project. Only images and models are read.
 */
async function readProjectFile(projectPath: unknown, ref: unknown) {
  if (!isProjectPath(projectPath) || typeof ref !== 'object' || ref === null) return null
  const { path, relative } = ref as Partial<ProjectFileRef>
  if (typeof path !== 'string') return null
  const dir = dirname(projectPath)
  const candidates = [
    isAbsolute(path) ? path : null,
    typeof relative === 'string' ? resolve(dir, relative) : null,
    // A path saved on another OS may use the other separator.
    join(dir, baseName(path))
  ]
  const readable = (name: string): boolean => isModelFile(name) || MAP_IMAGE_EXTENSIONS.includes(name.split('.').pop()?.toLowerCase() ?? '')
  for (const candidate of new Set(candidates)) {
    if (!candidate || !readable(candidate)) continue
    try {
      const info = await stat(candidate)
      if (!info.isFile() || info.size > MAX_MODEL_FILE) continue
      return { name: basename(candidate), bytes: new Uint8Array(await readFile(candidate)), path: candidate }
    } catch {
      // Not there: try the next place.
    }
  }
  return null
}

/** File watchers per window (see watch.ts), for live reloading. */
const watchers = new Map<Electron.WebContents, FileWatcher>()

function watcherFor(contents: Electron.WebContents): FileWatcher {
  let watcher = watchers.get(contents)
  if (!watcher) {
    const created = new FileWatcher((path) => {
      if (!contents.isDestroyed()) contents.send(IPC.fileChanged, path)
    })
    watchers.set(contents, created)
    contents.once('destroyed', () => {
      created.dispose()
      watchers.delete(contents)
    })
    watcher = created
  }
  return watcher
}

/** Windows whose project has unsaved changes, and ones closing after the user answered. */
const edited = new WeakSet<BrowserWindow>()
const closing = new WeakSet<BrowserWindow>()
const hung = new WeakSet<BrowserWindow>()

/**
 * Why the app is quitting ('relaunch': Settings' Restart now). A close held back for unsaved
 * changes cancels the quit, so the window remembers it and closeWindow quits once answered.
 */
let quitIntent: 'quit' | 'relaunch' | null = null
const pendingQuit = new WeakMap<BrowserWindow, 'quit' | 'relaunch' | null>()

/**
 * Closing a window with unsaved project changes (also by quitting) is held back; the renderer
 * asks whether to save, then closes it with closeWindow.
 */
function guardClose(win: BrowserWindow): void {
  win.on('close', (event) => {
    if (!edited.has(win) || closing.has(win) || win.webContents.isDestroyed() || win.webContents.isCrashed() || hung.has(win)) return
    event.preventDefault()
    pendingQuit.set(win, quitIntent)
    quitIntent = null
    win.webContents.send(IPC.closeRequested)
  })
  // While the page is hung nobody would answer the question: closing must still work.
  win.on('unresponsive', () => hung.add(win))
  win.on('responsive', () => hung.delete(win))
}

/** Settings is recording a shortcut: the menu's own shortcuts must not run meanwhile. */
let shortcutsSuspended = false

function refreshMenu(win: BrowserWindow): void {
  Menu.setApplicationMenu(buildMenu(win, isDev, getSettings().keybinds, !shortcutsSuspended))
}

function registerIpc(): void {
  ipcMain.handle(IPC.openImages, (event) =>
    openFiles(BrowserWindow.fromWebContents(event.sender)!, [{ name: 'Images', extensions: IMAGE_EXTENSIONS }])
  )

  ipcMain.handle(IPC.openModel, (event) =>
    openFile(BrowserWindow.fromWebContents(event.sender)!, [{ name: '3D models', extensions: [...MODEL_EXTENSIONS] }])
  )

  ipcMain.handle(IPC.readModelFile, (_e, modelPath: string, reference: string) => readModelFile(modelPath, reference))

  ipcMain.handle(IPC.openFile, (event, filters: FileFilter[]) =>
    openFile(BrowserWindow.fromWebContents(event.sender)!, filters)
  )

  ipcMain.handle(IPC.findMaps, (_e, texturePath: string) => findMaps(texturePath))

  ipcMain.on(IPC.watchFiles, (event, paths: unknown) => void watcherFor(event.sender).set(paths))
  ipcMain.handle(IPC.readWatchedFile, async (event, path: unknown) => {
    // Only the kinds of files the app opens (images, models and their resources).
    if (!watchers.get(event.sender)?.has(path) || !(isModelFile(path as string) || isModelResource(path as string))) return null
    const file = resolve(path as string)
    try {
      const info = await stat(file)
      if (!info.isFile() || info.size > MAX_MODEL_FILE) return null
      return { name: basename(file), bytes: new Uint8Array(await readFile(file)), path: file }
    } catch {
      return null
    }
  })

  ipcMain.handle(IPC.saveFile, async (event, defaultName: string, bytes: Uint8Array, filters: FileFilter[]) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    const result = await dialog.showSaveDialog(win, { defaultPath: defaultName, filters })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, bytes)
    return result.filePath
  })

  // Export into a folder: only folders the user picked in a dialog, only plain image file names.
  const exportFolders = new Set<string>()
  ipcMain.handle(IPC.chooseExportFolder, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    const result = await dialog.showOpenDialog(win, { title: 'Export all textures into', properties: ['openDirectory', 'createDirectory'] })
    const folder = result.filePaths[0]
    if (result.canceled || !folder) return null
    exportFolders.add(resolve(folder))
    return folder
  })
  ipcMain.handle(IPC.writeExportFile, async (_event, folder: unknown, name: unknown, bytes: unknown) => {
    if (typeof folder !== 'string' || !exportFolders.has(resolve(folder))) throw new Error('Pick the folder to export into first.')
    if (typeof name !== 'string' || !isExportFileName(name)) throw new Error(`"${String(name)}" isn't a file name the app exports.`)
    if (!(bytes instanceof Uint8Array)) throw new Error('Nothing to write.')
    const path = join(resolve(folder), name)
    await writeFile(path, bytes)
    return path
  })

  ipcMain.handle(IPC.projectOpen, (event) => openFile(BrowserWindow.fromWebContents(event.sender)!, PROJECT_FILTERS))
  ipcMain.handle(IPC.projectChoosePath, async (event, defaultName: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    const result = await dialog.showSaveDialog(win, { defaultPath: typeof defaultName === 'string' ? defaultName : undefined, filters: PROJECT_FILTERS })
    if (result.canceled || !result.filePath) return null
    if (isProjectFile(result.filePath)) return result.filePath
    // Some platforms don't add the extension from the filter; the dialog then never asked about
    // replacing the file with it.
    const path = `${result.filePath}.${PROJECT_EXTENSION}`
    const exists = await stat(path).then(() => true, () => false)
    if (exists) {
      const { response } = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Replace', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        message: `${basename(path)} already exists. Replace it?`
      })
      if (response !== 0) return null
    }
    return path
  })
  ipcMain.handle(IPC.projectWrite, (_e, path: unknown, json: unknown) => writeProject(path, json))
  ipcMain.handle(IPC.projectReadFile, (_e, projectPath: unknown, ref: unknown) => readProjectFile(projectPath, ref))

  ipcMain.on(IPC.documentEdited, (event, value: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (value === true) edited.add(win)
    else edited.delete(win)
    if (process.platform === 'darwin') win.setDocumentEdited(value === true)
  })
  ipcMain.on(IPC.closeWindow, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    closing.add(win)
    const intent = pendingQuit.get(win) ?? null
    pendingQuit.delete(win)
    if (intent) {
      quitIntent = intent
      app.quit()
    } else win.close()
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
  ipcMain.on(IPC.settingsSave, (event, patch: unknown) => {
    updateSettings(patch)
    // Changed shortcuts: rebuild the native menu, which provides them.
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && typeof patch === 'object' && patch !== null && 'keybinds' in patch) refreshMenu(win)
  })
  ipcMain.on(IPC.suspendShortcuts, (event, suspend: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    shortcutsSuspended = suspend === true
    if (win) refreshMenu(win)
  })
  // Relaunched from will-quit, so a quit cancelled at the unsaved-changes question leaves nothing pending.
  ipcMain.on(IPC.relaunch, () => {
    quitIntent = 'relaunch'
    app.quit()
  })
  ipcMain.handle(IPC.userDataShow, async () => {
    const error = await shell.openPath(app.getPath('userData'))
    if (error) throw new Error(error)
  })

  ipcMain.handle(IPC.gpuInfo, getGpuInfo)

  ipcMain.on(IPC.menuRole, (event, role: MenuRole) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && MENU_ROLES.includes(role)) runMenuRole(win, role)
  })
  ipcMain.on(IPC.titleBarOverlay, (event, overlay: TitleBarOverlay) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    // Only Windows and Linux draw native buttons over the page (macOS has its traffic lights).
    if (!win || process.platform === 'darwin') return
    try {
      win.setTitleBarOverlay({ color: overlay.color, symbolColor: overlay.symbolColor, height: Math.round(overlay.height) })
    } catch (e) {
      console.warn('Could not restyle the title bar buttons:', e)
    }
  })

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
/** Roles the renderer may ask for; reload and dev tools only in dev builds, like the menu offers them. */
const MENU_ROLES: MenuRole[] = ['cut', 'copy', 'paste', 'selectAll', 'togglefullscreen', 'quit', 'close', ...(isDev ? (['reload', 'toggleDevTools'] as const) : [])]

/**
 * The app draws its own title bar (menus included). Windows and Linux keep the native window
 * buttons, drawn over it (the renderer sets their colors from the theme); macOS keeps its traffic lights.
 */
function titleBarOptions(): Electron.BrowserWindowConstructorOptions {
  if (process.platform === 'darwin') return { titleBarStyle: 'hidden', trafficLightPosition: { x: 12, y: 10 } }
  // Matches --fx-titlebar-bg / -symbol / -height until the renderer applies the tokens.
  const colors = THEME_WINDOW_COLORS[getSettings().theme]
  return { titleBarStyle: 'hidden', titleBarOverlay: { color: colors.background, symbolColor: colors.symbol, height: 32 } }
}

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
    icon: join(app.getAppPath(), 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    backgroundColor: THEME_WINDOW_COLORS[getSettings().theme].background,
    ...(gpuReportPath ? {} : titleBarOptions()),
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
    guardClose(win)
    refreshMenu(win)
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

app.on('before-quit', () => {
  quitIntent ??= 'quit'
})

app.on('will-quit', () => {
  flushSettings()
  if (quitIntent === 'relaunch') app.relaunch()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
