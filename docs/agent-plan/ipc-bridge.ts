// ============================================================
//  core/ipc-bridge.ts — IPC channel setup for Electron
// ============================================================
//
// This module registers all ipcMain handlers and forwards
// EventBus events to the renderer process.  Import and call
// setupIPC(mainWindow, agent, registry, bus) once in main.ts.
//
// Renderer side uses window.electronAPI.* (exposed via preload).
// ============================================================

import { ipcMain, type BrowserWindow } from 'electron'
import type { Agent } from './agent'
import type { PluginRegistry } from './plugin-registry'
import type { EventBus, AgentEvent } from './types'

export function setupIPC(
  win: BrowserWindow,
  agent: Agent,
  registry: PluginRegistry,
  bus: EventBus
) {
  // ── Forward all bus events to renderer ───────────────────

  bus.on('agent:event', (event) => {
    if (!win.isDestroyed()) {
      win.webContents.send('agent:event', event)
    }
  })

  bus.on('plugin:state', (data) => {
    if (!win.isDestroyed()) {
      win.webContents.send('plugin:state', data)
    }
  })

  // ── Agent channels ──────────────────────────────────────

  ipcMain.handle('agent:send', async (_ev, message: string) => {
    const events: AgentEvent[] = []
    for await (const event of agent.run(message)) {
      events.push(event)
      // Events are also pushed via bus → "agent:event" above,
      // so the renderer gets them in real time.  The return
      // value here is mainly for await-style callers.
    }
    return events
  })

  ipcMain.handle('agent:abort', async () => {
    agent.abort()
    return { aborted: true }
  })

  ipcMain.handle('agent:clear', async () => {
    agent.clearHistory()
    return { cleared: true }
  })

  // ── Plugin channels ─────────────────────────────────────

  ipcMain.handle('plugins:list', async () => {
    return registry.getPluginInfo()
  })

  ipcMain.handle('plugins:health', async () => {
    return registry.healthCheck()
  })

  ipcMain.handle('plugins:reload', async (_ev, pluginId: string, config?: Record<string, any>) => {
    const ok = await registry.reloadPlugin(pluginId, config)
    return { pluginId, success: ok }
  })

  ipcMain.handle('plugins:unload', async (_ev, pluginId: string) => {
    await registry.unloadPlugin(pluginId)
    return { pluginId, unloaded: true }
  })
}

// ── Preload script types (for renderer consumption) ─────────
//
// Put this in a shared types file so both preload.ts and
// renderer code can import the same interface.

export interface ElectronAPI {
  // Agent
  sendMessage: (message: string) => Promise<AgentEvent[]>
  abortAgent: () => Promise<{ aborted: boolean }>
  clearHistory: () => Promise<{ cleared: boolean }>

  // Plugins
  listPlugins: () => Promise<ReturnType<PluginRegistry['getPluginInfo']>>
  healthCheck: () => Promise<string[]>
  reloadPlugin: (
    id: string,
    config?: Record<string, any>
  ) => Promise<{ pluginId: string; success: boolean }>
  unloadPlugin: (id: string) => Promise<{ pluginId: string; unloaded: boolean }>

  // Event listeners
  onAgentEvent: (callback: (event: AgentEvent) => void) => () => void
  onPluginState: (
    callback: (data: { pluginId: string; state: string; error?: string }) => void
  ) => () => void
}
