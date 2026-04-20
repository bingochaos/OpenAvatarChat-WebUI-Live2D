import { defineStore } from 'pinia'
import { nanoid } from 'nanoid'
import type {
  AgentEvent,
  ChatMessage,
  PluginInfo,
  PluginStatePayload,
  ToolCallView,
} from '@/interface/agent'

interface AgentState {
  messages: ChatMessage[]
  plugins: PluginInfo[]
  running: boolean
  apiReady: boolean
  currentAssistantText: string
  currentToolCalls: Record<string, ToolCallView>
  lastError: string | null
  subscribed: boolean
}

function createBlankMessage(role: ChatMessage['role']): ChatMessage {
  return {
    id: nanoid(),
    role,
    text: '',
    toolCalls: [],
    createdAt: Date.now(),
  }
}

export const useAgentStore = defineStore('agentStore', {
  state: (): AgentState => ({
    messages: [],
    plugins: [],
    running: false,
    apiReady: false,
    currentAssistantText: '',
    currentToolCalls: {},
    lastError: null,
    subscribed: false,
  }),

  actions: {
    async init() {
      if (typeof window === 'undefined' || !window.electronAgent) return
      if (this.subscribed) return
      this.subscribed = true

      try {
        const [ready, plugins] = await Promise.all([
          window.electronAgent.isReady(),
          window.electronAgent.listPlugins(),
        ])
        this.apiReady = ready.ready
        this.plugins = plugins
      } catch (err) {
        console.warn('agent init failed', err)
      }

      window.electronAgent.onAgentEvent((event: AgentEvent) => {
        this.handleEvent(event)
      })
      window.electronAgent.onPluginState((payload: PluginStatePayload) => {
        const idx = this.plugins.findIndex((p) => p.id === payload.pluginId)
        if (idx >= 0) {
          this.plugins[idx] = {
            ...this.plugins[idx],
            state: payload.state,
            error: payload.error,
          }
        }
      })
    },

    handleEvent(event: AgentEvent) {
      switch (event.type) {
        case 'text_delta':
          // The stream emits per-chunk deltas AND a full-text echo at
          // round end.  We append every delta; if a bigger echo arrives
          // after tool calls have flushed the buffer, it still reads well.
          this.currentAssistantText += event.text
          break
        case 'tool_start':
          this.currentToolCalls[event.callId] = {
            callId: event.callId,
            name: event.name,
            input: event.input,
            status: 'running',
          }
          break
        case 'tool_end': {
          const prev = this.currentToolCalls[event.callId]
          this.currentToolCalls[event.callId] = {
            callId: event.callId,
            name: event.name,
            input: prev?.input ?? {},
            result: event.result,
            durationMs: event.durationMs,
            status: event.result.success ? 'done' : 'error',
          }
          break
        }
        case 'turn_end':
          this.flushAssistant()
          this.running = false
          break
        case 'error':
          this.lastError = event.message
          this.flushAssistant(event.message)
          this.running = false
          break
      }
    },

    flushAssistant(errorMessage?: string) {
      const toolCalls = Object.values(this.currentToolCalls)
      const text = this.currentAssistantText.trim()
      if (!text && toolCalls.length === 0 && !errorMessage) {
        this.currentAssistantText = ''
        this.currentToolCalls = {}
        return
      }
      const msg = createBlankMessage('assistant')
      msg.text = text
      msg.toolCalls = toolCalls
      if (errorMessage) msg.error = errorMessage
      this.messages.push(msg)
      this.currentAssistantText = ''
      this.currentToolCalls = {}
    },

    async send(text: string) {
      const trimmed = text.trim()
      if (!trimmed || this.running) return
      if (!window.electronAgent) {
        this.lastError = '仅在 Electron 环境可用'
        return
      }

      const userMsg = createBlankMessage('user')
      userMsg.text = trimmed
      this.messages.push(userMsg)

      this.running = true
      this.lastError = null
      this.currentAssistantText = ''
      this.currentToolCalls = {}

      try {
        await window.electronAgent.sendMessage(trimmed)
      } catch (err: any) {
        this.lastError = err?.message ?? String(err)
        this.flushAssistant(this.lastError ?? undefined)
        this.running = false
      }
    },

    async abort() {
      if (!window.electronAgent) return
      await window.electronAgent.abortAgent()
    },

    async clear() {
      if (!window.electronAgent) return
      await window.electronAgent.clearHistory()
      this.messages = []
      this.currentAssistantText = ''
      this.currentToolCalls = {}
      this.lastError = null
    },

    async refreshPlugins() {
      if (!window.electronAgent) return
      this.plugins = await window.electronAgent.listPlugins()
    },
  },
})
