// Preload of the screen picker's overlay windows (src/main/screenPicker.ts).
import { contextBridge, ipcRenderer } from 'electron'
import { PICKER_IPC, type PickerApi, type ScreenCapture } from '@shared/screenPick'

const api: PickerApi = {
  onCapture: (listener) => void ipcRenderer.on(PICKER_IPC.capture, (_: unknown, capture: ScreenCapture) => listener(capture)),
  onPicked: (listener) => void ipcRenderer.on(PICKER_IPC.picked, (_: unknown, count: number) => listener(count)),
  ready: () => ipcRenderer.send(PICKER_IPC.ready),
  pick: (hex, more) => ipcRenderer.send(PICKER_IPC.pick, hex, more),
  done: () => ipcRenderer.send(PICKER_IPC.done)
}

contextBridge.exposeInMainWorld('picker', api)
