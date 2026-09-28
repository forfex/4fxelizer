import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type FxApi, type MenuCommand } from '@shared/api'

const api: FxApi = {
  platform: process.platform,
  openImage: () => ipcRenderer.invoke(IPC.openImage),
  saveImage: (defaultName, bytes) => ipcRenderer.invoke(IPC.saveImage, defaultName, bytes),
  getGpuInfo: () => ipcRenderer.invoke(IPC.gpuInfo),
  submitGpuReport: (report) => ipcRenderer.send(IPC.gpuReport, report),
  onMenuCommand: (listener) => {
    const handler = (_: unknown, command: MenuCommand): void => listener(command)
    ipcRenderer.on(IPC.menuCommand, handler)
    return () => ipcRenderer.removeListener(IPC.menuCommand, handler)
  }
}

contextBridge.exposeInMainWorld('fx', api)
