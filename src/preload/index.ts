import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron'
import { IPC, type FxApi, type MenuCommand } from '@shared/api'
import type { UpdateState } from '@shared/update'

const api: FxApi = {
  platform: process.platform,
  version: ipcRenderer.sendSync(IPC.appVersion),
  // Synchronous so the first render already uses the saved settings (the file is tiny).
  settings: ipcRenderer.sendSync(IPC.settingsLoad),
  saveSettings: (patch) => ipcRenderer.send(IPC.settingsSave, patch),
  openImages: () => ipcRenderer.invoke(IPC.openImages),
  openModel: () => ipcRenderer.invoke(IPC.openModel),
  readModelFile: (modelPath, reference) => ipcRenderer.invoke(IPC.readModelFile, modelPath, reference),
  openFile: (filters) => ipcRenderer.invoke(IPC.openFile, filters),
  saveFile: (defaultName, bytes, filters) => ipcRenderer.invoke(IPC.saveFile, defaultName, bytes, filters),
  chooseExportFolder: () => ipcRenderer.invoke(IPC.chooseExportFolder),
  writeExportFile: (folder, name, bytes) => ipcRenderer.invoke(IPC.writeExportFile, folder, name, bytes),
  findMaps: (texturePath) => ipcRenderer.invoke(IPC.findMaps, texturePath),
  pathForFile: (file) => webUtils.getPathForFile(file),
  watchFiles: (paths) => ipcRenderer.send(IPC.watchFiles, paths),
  onFileChanged: (listener) => {
    const handler = (_: unknown, path: string): void => listener(path)
    ipcRenderer.on(IPC.fileChanged, handler)
    return () => ipcRenderer.removeListener(IPC.fileChanged, handler)
  },
  readWatchedFile: (path) => ipcRenderer.invoke(IPC.readWatchedFile, path),
  openProject: () => ipcRenderer.invoke(IPC.projectOpen),
  chooseProjectPath: (defaultName) => ipcRenderer.invoke(IPC.projectChoosePath, defaultName),
  writeProject: (path, json) => ipcRenderer.invoke(IPC.projectWrite, path, json),
  readProjectFile: (projectPath, ref) => ipcRenderer.invoke(IPC.projectReadFile, projectPath, ref),
  setDocumentEdited: (edited) => ipcRenderer.send(IPC.documentEdited, edited),
  onCloseRequested: (listener) => {
    const handler = (): void => listener()
    ipcRenderer.on(IPC.closeRequested, handler)
    return () => ipcRenderer.removeListener(IPC.closeRequested, handler)
  },
  closeWindow: () => ipcRenderer.send(IPC.closeWindow),
  listPresets: () => ipcRenderer.invoke(IPC.presetsList),
  readPreset: (file) => ipcRenderer.invoke(IPC.presetsRead, file),
  writePreset: (file, json) => ipcRenderer.invoke(IPC.presetsWrite, file, json),
  deletePreset: (file) => ipcRenderer.invoke(IPC.presetsDelete, file),
  showPresetsFolder: () => ipcRenderer.invoke(IPC.presetsShow),
  getGpuInfo: () => ipcRenderer.invoke(IPC.gpuInfo),
  submitGpuReport: (report) => ipcRenderer.send(IPC.gpuReport, report),
  onMenuCommand: (listener) => {
    const handler = (_: unknown, command: MenuCommand): void => listener(command)
    ipcRenderer.on(IPC.menuCommand, handler)
    return () => ipcRenderer.removeListener(IPC.menuCommand, handler)
  },
  runMenuRole: (role) => ipcRenderer.send(IPC.menuRole, role),
  setTitleBarOverlay: (overlay) => ipcRenderer.send(IPC.titleBarOverlay, overlay),
  setUiScale: (scale) => webFrame.setZoomFactor(scale),
  relaunch: () => ipcRenderer.send(IPC.relaunch),
  showUserDataFolder: () => ipcRenderer.invoke(IPC.userDataShow),
  suspendShortcuts: (suspend) => ipcRenderer.send(IPC.suspendShortcuts, suspend),
  getUpdateState: () => ipcRenderer.invoke(IPC.updateGetState),
  onUpdateState: (listener) => {
    const handler = (_: unknown, state: UpdateState): void => listener(state)
    ipcRenderer.on(IPC.updateState, handler)
    return () => ipcRenderer.removeListener(IPC.updateState, handler)
  },
  checkForUpdates: () => ipcRenderer.send(IPC.updateCheck),
  installUpdate: () => ipcRenderer.send(IPC.updateInstall),
  restartToUpdate: () => ipcRenderer.send(IPC.updateRestart),
  pickScreenColors: () => ipcRenderer.invoke(IPC.pickScreenColors)
}

// Before the first render, so the page lays out at the saved scale.
if (typeof api.settings?.uiScale === 'number') webFrame.setZoomFactor(api.settings.uiScale)

contextBridge.exposeInMainWorld('fx', api)
