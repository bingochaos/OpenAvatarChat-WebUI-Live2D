// ============================================================
//  main.ts — Electron main process entry point
// ============================================================

import * as path from 'node:path'
import { app, BrowserWindow } from 'electron'
import { EventBus, Logger } from './core/types'
import { PluginRegistry } from './core/plugin-registry'
import { Agent } from './core/agent'
import { setupIPC } from './core/ipc-bridge'

const logger = new Logger('main')

let mainWindow: BrowserWindow
let bus: EventBus
let registry: PluginRegistry
let agent: Agent

async function bootstrap() {
  // 1. Shared event bus
  bus = new EventBus()

  // 2. Plugin registry — scan & init
  registry = new PluginRegistry(bus)

  const pluginsDir = path.join(__dirname, 'plugins')
  await registry.loadFromDir(pluginsDir)

  // TODO: load configs from electron-store
  await registry.initAll({
    potplayer: {
      potplayerPath: 'C:\\Program Files\\DAUM\\PotPlayer\\PotPlayerMini64.exe',
    },
    'browser-video': {
      locale: 'zh-CN',
    },
  })

  // 3. Agent
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '' // TODO: electron-store
  agent = new Agent(registry, bus, apiKey, {
    model: 'claude-sonnet-4-20250514',
    maxRounds: 15,
  })

  // 4. Window
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // 5. IPC
  setupIPC(mainWindow, agent, registry, bus)

  // 6. Periodic health check (every 30s)
  setInterval(async () => {
    const unhealthy = await registry.healthCheck()
    if (unhealthy.length > 0) {
      logger.warn('Unhealthy plugins', { ids: unhealthy })
    }
  }, 30_000)

  mainWindow.loadFile('index.html')
  logger.info('App ready')
}

app.whenReady().then(bootstrap)

app.on('before-quit', async () => {
  agent.abort()
  await registry.disposeAll()
  logger.info('Shutdown complete')
})
