import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC, type FxApi, type MenuCommand } from '@shared/api'

const api: FxApi = {
  platform: process.platform,
  // Synchronous so the first render already uses the saved settings (the file is tiny).
  settings: ipcRenderer.sendSync(IPC.settingsLoad),
  saveSettings: (patch) => ipcRenderer.send(IPC.settingsSave, patch),
  openImage: () => ipcRenderer.invoke(IPC.openImage),
  openModel: () => ipcRenderer.invoke(IPC.openModel),
  readModelFile: (modelPath, reference) => ipcRenderer.invoke(IPC.readModelFile, modelPath, reference),
  openFile: (filters) => ipcRenderer.invoke(IPC.openFile, filters),
  saveFile: (defaultName, bytes, filters) => ipcRenderer.invoke(IPC.saveFile, defaultName, bytes, filters),
  findMaps: (texturePath) => ipcRenderer.invoke(IPC.findMaps, texturePath),
  pathForFile: (file) => webUtils.getPathForFile(file),
  watchFiles: (paths) => ipcRenderer.send(IPC.watchFiles, paths),
  onFileChanged: (listener) => {
    const handler = (_: unknown, path: string): void => listener(path)
    ipcRenderer.on(IPC.fileChanged, handler)
    return () => ipcRenderer.removeListener(IPC.fileChanged, handler)
  },
  readWatchedFile: (path) => ipcRenderer.invoke(IPC.readWatchedFile, path),
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
  setTitleBarOverlay: (overlay) => ipcRenderer.send(IPC.titleBarOverlay, overlay)
}

contextBridge.exposeInMainWorld('fx', api)
