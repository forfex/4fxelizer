import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type FxApi, type MenuCommand } from '@shared/api'

const api: FxApi = {
  platform: process.platform,
  openImage: () => ipcRenderer.invoke(IPC.openImage),
  openFile: (filters) => ipcRenderer.invoke(IPC.openFile, filters),
  saveFile: (defaultName, bytes, filters) => ipcRenderer.invoke(IPC.saveFile, defaultName, bytes, filters),
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
  }
}

contextBridge.exposeInMainWorld('fx', api)
