// ============================================================
//  core/types.ts — All shared types for the plugin system
// ============================================================

import { EventEmitter } from 'node:events'

// ─── Tool Schema (matches Anthropic API) ────────────────────

export interface ToolInputSchema {
  type: 'object'
  properties: Record<
    string,
    {
      type: string
      description: string
      enum?: string[]
      default?: any
      minimum?: number
      maximum?: number
      items?: Record<string, any>
    }
  >
  required?: string[]
}

export interface ToolDefinition {
  name: string
  description: string
  input_schema: ToolInputSchema
}

export interface ToolResult {
  success: boolean
  data?: any
  error?: string
}

// ─── Plugin State Machine ───────────────────────────────────

export enum PluginState {
  /** Manifest loaded, class instantiated, not yet init() */
  Registered = 'registered',
  /** init() completed successfully */
  Ready = 'ready',
  /** init() or health check failed */
  Error = 'error',
  /** dispose() has been called */
  Disposed = 'disposed',
}

// ─── Plugin Manifest (manifest.json) ────────────────────────

export interface PluginManifest {
  id: string
  name: string
  entry: string
  enabled: boolean
  platform?: 'win32' | 'darwin' | 'linux'
  version?: string
  description?: string
  /** npm package names this plugin needs at runtime */
  dependencies?: string[]
}

// ─── Plugin Config ──────────────────────────────────────────

export interface PluginConfigField {
  key: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'path' | 'select'
  default?: any
  options?: { label: string; value: string }[]
  description?: string
  required?: boolean
}

// ─── Execution Context passed to every execute() call ───────

export interface ExecutionContext {
  /** Abort signal — plugin should check this in long operations */
  signal: AbortSignal
  /** Structured logger scoped to this tool call */
  logger: Logger
  /** Unique ID for this tool invocation (matches Anthropic tool_use_id) */
  callId: string
}

// ─── The Plugin Interface ───────────────────────────────────

export interface Plugin {
  readonly id: string
  readonly name: string
  readonly systemPrompt: string
  readonly tools: ToolDefinition[]

  init(config?: Record<string, any>): Promise<void>

  /**
   * Execute a tool. Receives an ExecutionContext with abort signal,
   * logger, and call metadata.
   */
  execute(toolName: string, input: Record<string, any>, ctx: ExecutionContext): Promise<ToolResult>

  dispose(): Promise<void>

  isHealthy?(): Promise<boolean>
  getConfigSchema?(): PluginConfigField[]
}

// ─── Agent Events ───────────────────────────────────────────
//
// These flow from Agent → IPC → Renderer.  The union type lets
// the renderer exhaustively switch on event.type.

export type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_start'; callId: string; name: string; input: Record<string, any> }
  | {
      type: 'tool_end'
      callId: string
      name: string
      result: ToolResult
      durationMs: number
    }
  | { type: 'turn_end'; totalRounds: number }
  | { type: 'error'; message: string; recoverable: boolean }

// ─── EventBus ───────────────────────────────────────────────
//
// Typed thin wrapper around Node EventEmitter.
// Agent, Registry, and IPC all share a single instance.

export type BusEvents = {
  'agent:event': [AgentEvent]
  'plugin:state': [{ pluginId: string; state: PluginState; error?: string }]
  'plugin:loaded': [{ pluginId: string; tools: string[] }]
  'plugin:unloaded': [{ pluginId: string }]
}

export class EventBus {
  private emitter = new EventEmitter()

  on<K extends keyof BusEvents>(event: K, fn: (...args: BusEvents[K]) => void) {
    this.emitter.on(event, fn as any)
    return () => this.emitter.off(event, fn as any)
  }

  emit<K extends keyof BusEvents>(event: K, ...args: BusEvents[K]) {
    this.emitter.emit(event, ...args)
  }
}

// ─── Logger ─────────────────────────────────────────────────

export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error'
  scope: string
  message: string
  data?: Record<string, any>
  timestamp: number
}

export class Logger {
  private static entries: LogEntry[] = []
  private static maxEntries = 2000
  private static listeners: ((entry: LogEntry) => void)[] = []

  constructor(private scope: string) {}

  child(subscope: string): Logger {
    return new Logger(`${this.scope}:${subscope}`)
  }

  debug(msg: string, data?: Record<string, any>) {
    this.log('debug', msg, data)
  }
  info(msg: string, data?: Record<string, any>) {
    this.log('info', msg, data)
  }
  warn(msg: string, data?: Record<string, any>) {
    this.log('warn', msg, data)
  }
  error(msg: string, data?: Record<string, any>) {
    this.log('error', msg, data)
  }

  private log(level: LogEntry['level'], message: string, data?: Record<string, any>) {
    const entry: LogEntry = {
      level,
      scope: this.scope,
      message,
      data,
      timestamp: Date.now(),
    }

    Logger.entries.push(entry)
    if (Logger.entries.length > Logger.maxEntries) {
      Logger.entries.shift()
    }

    const tag = `[${this.scope}]`
    if (level === 'error') console.error(tag, message, data ?? '')
    else if (level === 'warn') console.warn(tag, message, data ?? '')
    else if (level === 'debug') {
      /* silent in prod */
    } else console.log(tag, message, data ?? '')

    for (const fn of Logger.listeners) fn(entry)
  }

  /** Subscribe to all log entries (useful for renderer log panel) */
  static onEntry(fn: (entry: LogEntry) => void) {
    Logger.listeners.push(fn)
    return () => {
      Logger.listeners = Logger.listeners.filter((f) => f !== fn)
    }
  }

  /** Get recent entries (for crash reports, debug UI) */
  static getRecent(count = 100): LogEntry[] {
    return Logger.entries.slice(-count)
  }
}
