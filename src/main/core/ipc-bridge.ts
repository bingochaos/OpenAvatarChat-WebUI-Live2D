// ============================================================
//  core/ipc-bridge.ts — IPC channel setup for Electron
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

  ipcMain.handle('agent:ready', async () => {
    return { ready: agent.ready }
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

  ipcMain.handle('plugins:config:get', async () => {
    return registry.getPluginInfo().map((p) => ({
      id: p.id,
      configSchema: p.configSchema ?? [],
    }))
  })
}

// ── Preload script types (shared with renderer) ─────────────

export interface ElectronAgentAPI {
  sendMessage: (message: string) => Promise<AgentEvent[]>
  abortAgent: () => Promise<{ aborted: boolean }>
  clearHistory: () => Promise<{ cleared: boolean }>
  isReady: () => Promise<{ ready: boolean }>

  listPlugins: () => Promise<ReturnType<PluginRegistry['getPluginInfo']>>
  healthCheck: () => Promise<string[]>
  reloadPlugin: (
    id: string,
    config?: Record<string, any>
  ) => Promise<{ pluginId: string; success: boolean }>
  unloadPlugin: (id: string) => Promise<{ pluginId: string; unloaded: boolean }>

  onAgentEvent: (callback: (event: AgentEvent) => void) => () => void
  onPluginState: (
    callback: (data: { pluginId: string; state: string; error?: string }) => void
  ) => () => void
}
