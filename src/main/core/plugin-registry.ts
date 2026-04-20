// ============================================================
//  core/plugin-registry.ts — Plugin lifecycle + tool routing
// ============================================================

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Plugin, PluginManifest, ToolDefinition, ToolResult, ExecutionContext } from './types'
import { PluginState, EventBus, Logger } from './types'

// ─── Internal bookkeeping per plugin ────────────────────────

interface PluginEntry {
  plugin: Plugin
  manifest: PluginManifest
  state: PluginState
  folderPath?: string
  config?: Record<string, any>
  lastError?: string
}

// ─── Registry ───────────────────────────────────────────────

export class PluginRegistry {
  private plugins = new Map<string, PluginEntry>()
  private toolIndex = new Map<string, string>() // toolName → pluginId
  private logger: Logger

  constructor(private bus: EventBus) {
    this.logger = new Logger('registry')
  }

  // ── Static registration (Phase 2 primary path) ──────────

  /**
   * Register a pre-instantiated plugin without touching the filesystem.
   * Runs the same platform / enabled / id / tool-collision guards as
   * loadPlugin(), broadcasts plugin:loaded, and leaves the entry in
   * the Registered state so initAll() can drive it to Ready.
   */
  register(manifest: PluginManifest, plugin: Plugin, folderPath?: string): boolean {
    if (!manifest.enabled) {
      this.logger.info('Plugin disabled, skip', { id: manifest.id })
      return false
    }

    if (manifest.platform && manifest.platform !== process.platform) {
      this.logger.info('Wrong platform, skip', {
        id: manifest.id,
        need: manifest.platform,
        have: process.platform,
      })
      return false
    }

    if (this.plugins.has(manifest.id)) {
      this.logger.warn('Plugin already registered', { id: manifest.id })
      return false
    }

    if (plugin.id !== manifest.id) {
      this.logger.error('ID mismatch', {
        manifest: manifest.id,
        class: plugin.id,
      })
      return false
    }

    for (const tool of plugin.tools) {
      const owner = this.toolIndex.get(tool.name)
      if (owner) {
        this.logger.error('Tool name collision', {
          tool: tool.name,
          existingOwner: owner,
          newPlugin: manifest.id,
        })
        return false
      }
    }

    const entry: PluginEntry = {
      plugin,
      manifest,
      state: PluginState.Registered,
      folderPath,
    }

    this.plugins.set(manifest.id, entry)
    for (const tool of plugin.tools) {
      this.toolIndex.set(tool.name, manifest.id)
    }

    this.bus.emit('plugin:loaded', {
      pluginId: manifest.id,
      tools: plugin.tools.map((t) => t.name),
    })

    this.logger.info('Plugin registered', {
      id: manifest.id,
      tools: plugin.tools.length,
    })

    return true
  }

  // ── Dynamic discovery (kept for Phase 3, not wired in Phase 2) ──
  // TODO(phase-3): switch from CommonJS require() to ESM dynamic
  // import(url + '?t=' + Date.now()) to enable true hot reload.

  async loadFromDir(pluginsDir: string): Promise<void> {
    if (!fs.existsSync(pluginsDir)) {
      this.logger.warn('Plugins directory not found', { path: pluginsDir })
      return
    }

    const folders = fs
      .readdirSync(pluginsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)

    for (const folder of folders) {
      await this.loadPlugin(path.join(pluginsDir, folder))
    }
  }

  async loadPlugin(folderPath: string): Promise<boolean> {
    const manifestPath = path.join(folderPath, 'manifest.json')
    if (!fs.existsSync(manifestPath)) return false

    let manifest: PluginManifest
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    } catch (err: any) {
      this.logger.error('Bad manifest.json', { path: manifestPath, error: err.message })
      return false
    }

    const entryPath = path.join(folderPath, manifest.entry)
    let plugin: Plugin
    try {
      const mod: any = await import(/* @vite-ignore */ entryPath)
      const Ctor = mod.default ?? mod
      plugin = new Ctor()
    } catch (err: any) {
      this.logger.error('Failed to import plugin', {
        id: manifest.id,
        error: err.message,
      })
      return false
    }

    return this.register(manifest, plugin, folderPath)
  }

  // ── Initialization ──────────────────────────────────────

  /** Initialize all registered plugins. Failures are isolated. */
  async initAll(configs?: Record<string, Record<string, any>>): Promise<void> {
    const tasks = [...this.plugins.entries()].map(async ([id, entry]) => {
      if (entry.state !== PluginState.Registered) return

      entry.config = configs?.[id]

      try {
        await withTimeout(entry.plugin.init(entry.config), 10_000, `Plugin "${id}" init timed out`)

        entry.state = PluginState.Ready
        this.bus.emit('plugin:state', { pluginId: id, state: PluginState.Ready })
        this.logger.info('Plugin ready', { id })
      } catch (err: any) {
        entry.state = PluginState.Error
        entry.lastError = err.message
        this.bus.emit('plugin:state', {
          pluginId: id,
          state: PluginState.Error,
          error: err.message,
        })
        this.logger.error('Plugin init failed', { id, error: err.message })

        for (const tool of entry.plugin.tools) {
          this.toolIndex.delete(tool.name)
        }
      }
    })

    await Promise.allSettled(tasks)
  }

  // ── Getters for Agent ───────────────────────────────────

  /** All tool definitions from Ready plugins. */
  getAllTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = []
    for (const entry of this.plugins.values()) {
      if (entry.state === PluginState.Ready) {
        tools.push(...entry.plugin.tools)
      }
    }
    return tools
  }

  /** Combined system prompt. */
  getSystemPrompt(): string {
    const sections: string[] = [
      'You are a desktop assistant that controls applications via the ' +
        'tools below. Check current state before making changes. Use the ' +
        'minimum tool calls needed. If a tool returns an error, tell the ' +
        'user instead of retrying blindly.',
    ]

    for (const entry of this.plugins.values()) {
      if (entry.state === PluginState.Ready) {
        sections.push(`## ${entry.plugin.name}\n${entry.plugin.systemPrompt}`)
      }
    }

    return sections.join('\n\n')
  }

  /** Info for the UI settings panel. */
  getPluginInfo(): Array<{
    id: string
    name: string
    state: PluginState
    tools: string[]
    error?: string
    configSchema?: ReturnType<NonNullable<Plugin['getConfigSchema']>>
  }> {
    return [...this.plugins.values()].map((e) => ({
      id: e.manifest.id,
      name: e.manifest.name,
      state: e.state,
      tools: e.plugin.tools.map((t) => t.name),
      error: e.lastError,
      configSchema: e.plugin.getConfigSchema?.(),
    }))
  }

  // ── Execution ───────────────────────────────────────────

  async execute(
    toolName: string,
    input: Record<string, any>,
    ctx: ExecutionContext
  ): Promise<ToolResult> {
    const pluginId = this.toolIndex.get(toolName)
    if (!pluginId) {
      return { success: false, error: `Unknown tool: "${toolName}"` }
    }

    const entry = this.plugins.get(pluginId)
    if (!entry || entry.state !== PluginState.Ready) {
      return {
        success: false,
        error: `Plugin "${pluginId}" is not ready (state: ${entry?.state ?? 'missing'})`,
      }
    }

    try {
      const result = await withTimeout(
        entry.plugin.execute(toolName, input, ctx),
        30_000,
        `Tool "${toolName}" execution timed out (30s)`
      )
      return result
    } catch (err: any) {
      ctx.logger.error('Tool execution failed', { tool: toolName, error: err.message })
      return { success: false, error: `Tool "${toolName}" threw: ${err.message}` }
    }
  }

  // ── Hot Reload (Phase 3) ────────────────────────────────

  async reloadPlugin(pluginId: string, config?: Record<string, any>): Promise<boolean> {
    const entry = this.plugins.get(pluginId)
    if (!entry) return false

    const folderPath = entry.folderPath
    if (!folderPath) {
      this.logger.warn('reloadPlugin requires folderPath (dynamic load only)', {
        id: pluginId,
      })
      return false
    }

    await this.unloadPlugin(pluginId)

    const loaded = await this.loadPlugin(folderPath)
    if (!loaded) return false

    await this.initAll({ [pluginId]: config ?? entry.config ?? {} })
    return this.plugins.get(pluginId)?.state === PluginState.Ready
  }

  // ── Lifecycle ───────────────────────────────────────────

  async unloadPlugin(pluginId: string): Promise<void> {
    const entry = this.plugins.get(pluginId)
    if (!entry) return

    try {
      await withTimeout(entry.plugin.dispose(), 5_000, 'dispose timeout')
    } catch (err: any) {
      this.logger.warn('Error during dispose', { id: pluginId, error: err.message })
    }

    for (const tool of entry.plugin.tools) {
      this.toolIndex.delete(tool.name)
    }
    this.plugins.delete(pluginId)
    this.bus.emit('plugin:unloaded', { pluginId })
    this.logger.info('Plugin unloaded', { id: pluginId })
  }

  async healthCheck(): Promise<string[]> {
    const unhealthy: string[] = []
    for (const [id, entry] of this.plugins) {
      if (entry.state !== PluginState.Ready) continue
      if (!entry.plugin.isHealthy) continue

      try {
        const ok = await withTimeout(entry.plugin.isHealthy(), 3_000, 'health check timeout')
        if (!ok) {
          entry.state = PluginState.Error
          entry.lastError = 'Health check returned false'
          unhealthy.push(id)
          this.bus.emit('plugin:state', {
            pluginId: id,
            state: PluginState.Error,
            error: entry.lastError,
          })
        }
      } catch (err: any) {
        entry.state = PluginState.Error
        entry.lastError = err.message
        unhealthy.push(id)
      }
    }
    return unhealthy
  }

  async disposeAll(): Promise<void> {
    const ids = [...this.plugins.keys()]
    await Promise.allSettled(ids.map((id) => this.unloadPlugin(id)))
  }
}

// ─── Utility ────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}
