// ============================================================
//  core/agent.ts — LLM tool-use loop with streaming & abort
// ============================================================

import Anthropic from '@anthropic-ai/sdk'
import type { PluginRegistry } from './plugin-registry'
import type { AgentEvent, ExecutionContext } from './types'
import { EventBus, Logger } from './types'

// ─── Conversation message types ─────────────────────────────

interface Message {
  role: 'user' | 'assistant'
  content: any
}

export interface AgentOptions {
  model?: string
  maxRounds?: number
  maxTokens?: number
  /** Per-tool execution timeout (ms). Default: 30000 */
  toolTimeout?: number
}

const DEFAULTS: Required<AgentOptions> = {
  model: 'claude-sonnet-4-20250514',
  maxRounds: 15,
  maxTokens: 4096,
  toolTimeout: 30_000,
}

// ─── Agent ──────────────────────────────────────────────────

export class Agent {
  private client: Anthropic
  private messages: Message[] = []
  private opts: Required<AgentOptions>
  private logger: Logger
  private abortController: AbortController | null = null

  constructor(
    private registry: PluginRegistry,
    private bus: EventBus,
    apiKey: string,
    opts?: AgentOptions
  ) {
    this.client = new Anthropic({ apiKey })
    this.opts = { ...DEFAULTS, ...opts }
    this.logger = new Logger('agent')
  }

  // ── Public API ──────────────────────────────────────────

  /**
   * Run agent loop for a user message.
   * Returns an async generator of AgentEvents for the UI.
   *
   * The loop is abortable — call agent.abort() from another
   * context (e.g. a "Stop" button IPC handler).
   */
  async *run(userMessage: string): AsyncGenerator<AgentEvent> {
    this.abortController = new AbortController()
    const { signal } = this.abortController

    this.messages.push({ role: 'user', content: userMessage })
    this.logger.info('User message', { length: userMessage.length })

    let round = 0

    try {
      for (; round < this.opts.maxRounds; round++) {
        if (signal.aborted) {
          yield { type: 'error', message: 'Aborted by user', recoverable: true }
          return
        }

        // ── Stream the LLM response ───────────────────────
        this.logger.debug('Calling LLM', { round, model: this.opts.model })

        const tools = this.registry.getAllTools()
        if (tools.length === 0) {
          this.logger.warn('No tools available — all plugins may be down')
        }

        let response: Anthropic.Message
        let streamedText = ''

        try {
          const stream = this.client.messages.stream({
            model: this.opts.model,
            max_tokens: this.opts.maxTokens,
            system: this.registry.getSystemPrompt(),
            tools: tools as any,
            messages: this.messages,
          })

          // Emit text deltas as they arrive
          stream.on('text', (text) => {
            streamedText += text
            const event: AgentEvent = { type: 'text_delta', text }
            this.bus.emit('agent:event', event)
          })

          response = await stream.finalMessage()
        } catch (err: any) {
          if (signal.aborted) {
            yield { type: 'error', message: 'Aborted by user', recoverable: true }
            return
          }

          this.logger.error('API call failed', { error: err.message })

          // Retry once on transient errors
          if (isRetryable(err) && round < this.opts.maxRounds - 1) {
            this.logger.info('Retrying after transient error')
            await sleep(1000)
            continue
          }

          yield { type: 'error', message: `API error: ${err.message}`, recoverable: false }
          return
        }

        // ── Push assistant message to history ─────────────
        this.messages.push({ role: 'assistant', content: response.content })

        // Yield the full text (UI already got deltas via bus,
        // but the generator consumer also needs it)
        if (streamedText) {
          yield { type: 'text_delta', text: streamedText }
        }

        // ── Check stop reason ─────────────────────────────
        if (response.stop_reason === 'end_turn') {
          yield { type: 'turn_end', totalRounds: round + 1 }
          return
        }

        // ── Collect tool_use blocks ───────────────────────
        const toolBlocks = response.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
        )

        if (toolBlocks.length === 0) {
          yield { type: 'turn_end', totalRounds: round + 1 }
          return
        }

        // ── Execute tools ─────────────────────────────────
        const toolResults: any[] = []

        for (const block of toolBlocks) {
          if (signal.aborted) {
            yield { type: 'error', message: 'Aborted during tool execution', recoverable: true }
            return
          }

          const input = block.input as Record<string, any>
          const callId = block.id
          const toolLogger = this.logger.child(`tool:${block.name}`)

          const ctx: ExecutionContext = {
            signal,
            logger: toolLogger,
            callId,
          }

          // Emit start
          const startEvent: AgentEvent = {
            type: 'tool_start',
            callId,
            name: block.name,
            input,
          }
          yield startEvent
          this.bus.emit('agent:event', startEvent)

          // Execute
          const t0 = Date.now()
          const result = await this.registry.execute(block.name, input, ctx)
          const durationMs = Date.now() - t0

          // Emit end
          const endEvent: AgentEvent = {
            type: 'tool_end',
            callId,
            name: block.name,
            result,
            durationMs,
          }
          yield endEvent
          this.bus.emit('agent:event', endEvent)

          toolLogger.info('Completed', { durationMs, success: result.success })

          toolResults.push({
            type: 'tool_result',
            tool_use_id: callId,
            content: JSON.stringify(result),
          })
        }

        // Feed results back to Claude
        this.messages.push({ role: 'user', content: toolResults })
      }

      // Exhausted rounds
      yield {
        type: 'error',
        message: `Reached max rounds (${this.opts.maxRounds})`,
        recoverable: true,
      }
    } finally {
      this.abortController = null
    }
  }

  /** Abort the currently running agent loop. */
  abort(): void {
    this.abortController?.abort()
    this.logger.info('Abort requested')
  }

  /** Clear conversation for a fresh start. */
  clearHistory(): void {
    this.messages = []
    this.logger.info('History cleared')
  }

  /** Get the conversation length (for UI display). */
  get historyLength(): number {
    return this.messages.length
  }
}

// ─── Helpers ────────────────────────────────────────────────

function isRetryable(err: any): boolean {
  const status = err?.status ?? err?.statusCode
  if (status === 429 || status === 500 || status === 503) return true
  if (err?.code === 'ECONNRESET' || err?.code === 'ETIMEDOUT') return true
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
