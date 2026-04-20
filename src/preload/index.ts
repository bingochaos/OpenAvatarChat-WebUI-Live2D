import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {}

// Agent bridge — exposes main/core/ipc-bridge.ts channels
const electronAgent = {
  sendMessage: (message: string) => ipcRenderer.invoke('agent:send', message),
  abortAgent: () => ipcRenderer.invoke('agent:abort'),
  clearHistory: () => ipcRenderer.invoke('agent:clear'),
  isReady: () => ipcRenderer.invoke('agent:ready'),

  listPlugins: () => ipcRenderer.invoke('plugins:list'),
  healthCheck: () => ipcRenderer.invoke('plugins:health'),
  reloadPlugin: (id: string, config?: Record<string, any>) =>
    ipcRenderer.invoke('plugins:reload', id, config),
  unloadPlugin: (id: string) => ipcRenderer.invoke('plugins:unload', id),

  onAgentEvent: (cb: (event: unknown) => void) => {
    const handler = (_ev: IpcRendererEvent, payload: unknown) => cb(payload)
    ipcRenderer.on('agent:event', handler)
    return () => ipcRenderer.off('agent:event', handler)
  },
  onPluginState: (cb: (data: unknown) => void) => {
    const handler = (_ev: IpcRendererEvent, payload: unknown) => cb(payload)
    ipcRenderer.on('plugin:state', handler)
    return () => ipcRenderer.off('plugin:state', handler)
  },
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('electronInfo', {
      version: process.version,
      platform: process.platform,
    })
    contextBridge.exposeInMainWorld('safeApi', {
      fetch: (url: string, options?: RequestInit) => {
        console.log('🚀 ~ url, options:', url, options)
        return ipcRenderer.invoke('safe-fetch', { url, options })
      },
    })
    contextBridge.exposeInMainWorld('electronAgent', electronAgent)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.electronInfo = {
    version: process.version,
    platform: process.platform,
  }
  // @ts-ignore (define in dts)
  window.api = api
  // @ts-ignore (define in dts)
  window.electronAgent = electronAgent
}
console.log(window.electronInfo)
console.log(window.api)
console.log(window.electron)
console.log(process.contextIsolated)

document.addEventListener('DOMContentLoaded', () => {
  const app = document.getElementById('app')
  if (app) {
    app.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      ipcRenderer.send('show-context-menu')
    })
  }
})
