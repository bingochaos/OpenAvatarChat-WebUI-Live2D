// ============================================================
//  plugins/potplayer/index.ts — Windows-only PotPlayer driver
// ============================================================
//
// Control PotPlayer through its documented command-line switches.
// Limitations: this is NOT a real IPC channel into a running
// PotPlayer instance — every "action" spawns PotPlayerMini64.exe
// with switches that the target window processes.  Good enough
// for a tool-using agent demo; not good enough for frame-precise
// control.

import * as fs from 'node:fs'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import type {
  Plugin,
  ToolDefinition,
  ToolResult,
  ExecutionContext,
  PluginConfigField,
} from '../../core/types'
import manifestJson from './manifest.json'

export const manifest = manifestJson

const execFileAsync = promisify(execFile)

const DEFAULT_CANDIDATES = [
  'C:\\Program Files\\DAUM\\PotPlayer\\PotPlayerMini64.exe',
  'C:\\Program Files (x86)\\DAUM\\PotPlayer\\PotPlayerMini.exe',
]

export default class PotPlayerPlugin implements Plugin {
  readonly id = 'potplayer'
  readonly name = 'PotPlayer Controller'

  readonly systemPrompt = [
    '使用下列工具控制本机 PotPlayer：打开本地/远程视频、播放/暂停、拖动、',
    '调整音量、关闭播放器。所有时间参数单位为毫秒，音量范围 0-100。',
    '注意：PotPlayer 的命令行控制只作用于当前活动的 PotPlayer 窗口；若用户',
    '尚未打开任何实例，请先调用 potplayer_open_file。',
  ].join('\n')

  readonly tools: ToolDefinition[] = [
    {
      name: 'potplayer_open_file',
      description: '使用 PotPlayer 打开一个本地文件路径或 URL。若已有实例在运行，会复用当前窗口。',
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '本地绝对路径或 http(s) 视频地址',
          },
        },
        required: ['path'],
      },
    },
    {
      name: 'potplayer_play_pause',
      description: '切换 PotPlayer 当前窗口的播放/暂停状态。',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'potplayer_seek',
      description: '将当前播放位置跳转到指定毫秒。',
      input_schema: {
        type: 'object',
        properties: {
          positionMs: {
            type: 'number',
            description: '目标时间，单位毫秒',
            minimum: 0,
          },
        },
        required: ['positionMs'],
      },
    },
    {
      name: 'potplayer_set_volume',
      description: '把音量设置为 0-100 的值。',
      input_schema: {
        type: 'object',
        properties: {
          level: {
            type: 'number',
            description: '音量百分比，0-100',
            minimum: 0,
            maximum: 100,
          },
        },
        required: ['level'],
      },
    },
    {
      name: 'potplayer_close',
      description: '关闭所有 PotPlayer 进程。',
      input_schema: { type: 'object', properties: {} },
    },
  ]

  private exePath: string | null = null

  // ── Lifecycle ───────────────────────────────────────────

  async init(config?: Record<string, any>): Promise<void> {
    const configured = config?.potplayerPath as string | undefined
    const candidates = [configured, ...DEFAULT_CANDIDATES].filter(Boolean) as string[]

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        this.exePath = candidate
        return
      }
    }

    const detected = await this.detectFromRegistry()
    if (detected && fs.existsSync(detected)) {
      this.exePath = detected
      return
    }

    throw new Error(
      'Could not locate PotPlayerMini64.exe. Please set "potplayerPath" in the plugin config.'
    )
  }

  async dispose(): Promise<void> {
    this.exePath = null
  }

  async isHealthy(): Promise<boolean> {
    return Boolean(this.exePath && fs.existsSync(this.exePath))
  }

  getConfigSchema(): PluginConfigField[] {
    return [
      {
        key: 'potplayerPath',
        label: 'PotPlayer 可执行文件路径',
        type: 'path',
        description: '留空则自动探测注册表与默认安装目录',
        required: false,
      },
    ]
  }

  // ── Tool routing ────────────────────────────────────────

  async execute(
    toolName: string,
    input: Record<string, any>,
    ctx: ExecutionContext
  ): Promise<ToolResult> {
    if (ctx.signal.aborted) return { success: false, error: 'aborted' }
    if (!this.exePath) return { success: false, error: 'PotPlayer path not resolved' }

    try {
      switch (toolName) {
        case 'potplayer_open_file':
          return await this.openFile(String(input.path ?? ''), ctx)
        case 'potplayer_play_pause':
          return await this.runSwitches(['/play_pause'], ctx)
        case 'potplayer_seek':
          return await this.runSwitches(
            [`/seek=${Math.max(0, Math.floor(Number(input.positionMs ?? 0)))}`],
            ctx
          )
        case 'potplayer_set_volume':
          return await this.runSwitches([`/volume=${clamp(Number(input.level ?? 0), 0, 100)}`], ctx)
        case 'potplayer_close':
          return await this.closeAll(ctx)
        default:
          return { success: false, error: `Unknown tool: ${toolName}` }
      }
    } catch (err: any) {
      ctx.logger.error('execute failed', { tool: toolName, error: err.message })
      return { success: false, error: err.message }
    }
  }

  // ── Implementations ─────────────────────────────────────

  private async openFile(target: string, ctx: ExecutionContext): Promise<ToolResult> {
    if (!target) return { success: false, error: 'path is required' }

    const isUrl = /^https?:\/\//i.test(target)
    if (!isUrl && !fs.existsSync(target)) {
      return { success: false, error: `file not found: ${target}` }
    }

    const child = spawn(this.exePath!, [target, '/current'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    })
    child.unref()

    ctx.logger.info('opened', { target, isUrl })
    return { success: true, data: { opened: target } }
  }

  private async runSwitches(args: string[], ctx: ExecutionContext): Promise<ToolResult> {
    const child = spawn(this.exePath!, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    })
    child.unref()
    ctx.logger.info('switch sent', { args })
    return { success: true, data: { args } }
  }

  private async closeAll(ctx: ExecutionContext): Promise<ToolResult> {
    const exeName = this.exePath!.split(/[\\/]/).pop() ?? 'PotPlayerMini64.exe'
    try {
      await execFileAsync('taskkill', ['/F', '/IM', exeName])
      ctx.logger.info('closed', { exe: exeName })
      return { success: true, data: { closed: exeName } }
    } catch (err: any) {
      // taskkill returns non-zero when process is not running — treat as ok
      if ((err.stdout ?? '').includes('not found') || err.code === 128) {
        return { success: true, data: { closed: exeName, wasRunning: false } }
      }
      return { success: false, error: err.message }
    }
  }

  // ── Windows registry probing ────────────────────────────

  private async detectFromRegistry(): Promise<string | null> {
    const keys = [
      'HKLM\\SOFTWARE\\DAUM\\PotPlayer64',
      'HKLM\\SOFTWARE\\DAUM\\PotPlayer',
      'HKLM\\SOFTWARE\\WOW6432Node\\DAUM\\PotPlayer',
    ]
    for (const key of keys) {
      try {
        const { stdout } = await execFileAsync('reg', ['query', key, '/v', 'ProgramPath'])
        const match = stdout.match(/ProgramPath\s+REG_\w+\s+(.+?)\s*$/m)
        if (match?.[1]) return match[1].trim()
      } catch {
        /* try next key */
      }
    }
    return null
  }
}

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min
  return Math.min(max, Math.max(min, n))
}
