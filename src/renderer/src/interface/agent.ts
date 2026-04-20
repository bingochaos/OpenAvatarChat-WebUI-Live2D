// Mirror of main/core types for renderer-side usage.
// Keep in sync with src/main/core/types.ts.

export interface ToolResult {
  success: boolean
  data?: any
  error?: string
}

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

export interface PluginConfigField {
  key: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'path' | 'select'
  default?: any
  options?: { label: string; value: string }[]
  description?: string
  required?: boolean
}

export type PluginState = 'registered' | 'ready' | 'error' | 'disposed'

export interface PluginInfo {
  id: string
  name: string
  state: PluginState
  tools: string[]
  error?: string
  configSchema?: PluginConfigField[]
}

export interface PluginStatePayload {
  pluginId: string
  state: PluginState
  error?: string
}

export interface ToolCallView {
  callId: string
  name: string
  input: Record<string, any>
  result?: ToolResult
  durationMs?: number
  status: 'running' | 'done' | 'error'
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  toolCalls: ToolCallView[]
  error?: string
  createdAt: number
}

export interface ElectronAgentAPI {
  sendMessage: (message: string) => Promise<AgentEvent[]>
  abortAgent: () => Promise<{ aborted: boolean }>
  clearHistory: () => Promise<{ cleared: boolean }>
  isReady: () => Promise<{ ready: boolean }>

  listPlugins: () => Promise<PluginInfo[]>
  healthCheck: () => Promise<string[]>
  reloadPlugin: (
    id: string,
    config?: Record<string, any>
  ) => Promise<{ pluginId: string; success: boolean }>
  unloadPlugin: (id: string) => Promise<{ pluginId: string; unloaded: boolean }>

  onAgentEvent: (callback: (event: AgentEvent) => void) => () => void
  onPluginState: (callback: (data: PluginStatePayload) => void) => () => void
}
