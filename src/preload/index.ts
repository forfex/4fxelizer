import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron'
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
  suspendShortcuts: (suspend) => ipcRenderer.send(IPC.suspendShortcuts, suspend)
}

// Before the first render, so the page lays out at the saved scale.
if (typeof api.settings?.uiScale === 'number') webFrame.setZoomFactor(api.settings.uiScale)

contextBridge.exposeInMainWorld('fx', api)
