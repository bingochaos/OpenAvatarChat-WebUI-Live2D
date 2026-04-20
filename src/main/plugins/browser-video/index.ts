// ============================================================
//  plugins/browser-video/index.ts — Playwright-driven browser
// ============================================================

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import type {
  Plugin,
  ToolDefinition,
  ToolResult,
  ExecutionContext,
  PluginConfigField,
} from '../../core/types'
import manifestJson from './manifest.json'

export const manifest = manifestJson

const MAX_A11Y_CHARS = 4000
const MAX_TEXT_CHARS = 4000

export default class BrowserVideoPlugin implements Plugin {
  readonly id = 'browser-video'
  readonly name = 'Browser Video Controller'

  readonly systemPrompt = [
    '使用下列工具操作浏览器来搜索并播放视频（B 站、YouTube 等）。',
    '步骤建议：先 browser_open_url 打开网址，再用 browser_get_text / ',
    'browser_get_a11y_tree 查看页面可交互元素，接着用 browser_click / ',
    'browser_type / browser_press_key 操作。结果页面文字较长时会被自动截断。',
    '选择器优先使用 role / text / aria-label；避免写死 CSS 类名。',
  ].join('\n')

  readonly tools: ToolDefinition[] = [
    {
      name: 'browser_open_url',
      description: '打开或跳转到指定 URL（仅 http/https）。',
      input_schema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '完整 http(s) URL' },
        },
        required: ['url'],
      },
    },
    {
      name: 'browser_click',
      description: '点击页面元素。selector 支持 CSS / text=/ role= 等 Playwright 语法。',
      input_schema: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'Playwright selector' },
        },
        required: ['selector'],
      },
    },
    {
      name: 'browser_type',
      description: '在匹配的输入框中键入文本，默认清空原有内容。',
      input_schema: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: '输入框 selector' },
          text: { type: 'string', description: '要键入的文本' },
          pressEnter: {
            type: 'boolean',
            description: '键入后是否自动按 Enter',
            default: false,
          },
        },
        required: ['selector', 'text'],
      },
    },
    {
      name: 'browser_press_key',
      description: '按下键盘按键，例如 Enter、Escape、Tab、ArrowDown。',
      input_schema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Playwright key name' },
        },
        required: ['key'],
      },
    },
    {
      name: 'browser_get_text',
      description: '抓取当前页面可见文本，结果将被截断到 ~4000 字符。优先用于简单信息提取。',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'browser_get_a11y_tree',
      description:
        '抓取页面 Accessibility Tree 摘要（仅保留可交互节点）。用于分析页面结构，结果会截断到 ~4000 字符。',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'browser_close',
      description: '关闭当前浏览器窗口与会话。',
      input_schema: { type: 'object', properties: {} },
    },
  ]

  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private page: Page | null = null
  private locale = 'zh-CN'
  private allowLocal = false

  // ── Lifecycle ───────────────────────────────────────────

  async init(config?: Record<string, any>): Promise<void> {
    this.locale = String(config?.locale ?? 'zh-CN')
    this.allowLocal = Boolean(config?.allowLocal ?? false)

    this.browser = await chromium.launch({
      channel: 'chrome',
      headless: false,
    })
    this.context = await this.browser.newContext({ locale: this.locale })
    this.context.on('close', () => {
      this.context = null
      this.page = null
    })
    this.page = await this.context.newPage()
    this.attachPageListeners(this.page)
  }

  async dispose(): Promise<void> {
    try {
      await this.context?.close()
    } catch {
      /* ignore */
    }
    try {
      await this.browser?.close()
    } catch {
      /* ignore */
    }
    this.browser = null
    this.context = null
    this.page = null
  }

  async isHealthy(): Promise<boolean> {
    return Boolean(this.browser?.isConnected())
  }

  getConfigSchema(): PluginConfigField[] {
    return [
      {
        key: 'locale',
        label: '浏览器区域',
        type: 'string',
        default: 'zh-CN',
        required: false,
      },
      {
        key: 'allowLocal',
        label: '允许访问 localhost / 私网地址',
        type: 'boolean',
        default: false,
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

    try {
      switch (toolName) {
        case 'browser_open_url':
          return await this.openUrl(String(input.url ?? ''), ctx)
        case 'browser_click':
          return await this.click(String(input.selector ?? ''), ctx)
        case 'browser_type':
          return await this.type(
            String(input.selector ?? ''),
            String(input.text ?? ''),
            Boolean(input.pressEnter),
            ctx
          )
        case 'browser_press_key':
          return await this.pressKey(String(input.key ?? ''), ctx)
        case 'browser_get_text':
          return await this.getText(ctx)
        case 'browser_get_a11y_tree':
          return await this.getA11yTree(ctx)
        case 'browser_close':
          return await this.closeBrowser(ctx)
        default:
          return { success: false, error: `Unknown tool: ${toolName}` }
      }
    } catch (err: any) {
      ctx.logger.error('execute failed', { tool: toolName, error: err.message })
      return { success: false, error: err.message }
    }
  }

  // ── Implementations ─────────────────────────────────────

  private async ensurePage(): Promise<Page> {
    if (!this.browser || !this.browser.isConnected()) {
      throw new Error('browser not running; the plugin may need reload')
    }
    if (!this.context) {
      this.context = await this.browser.newContext({ locale: this.locale })
      this.context.on('close', () => {
        this.context = null
        this.page = null
      })
    }
    if (!this.page || this.page.isClosed()) {
      this.page = await this.context.newPage()
      this.attachPageListeners(this.page)
    }
    return this.page
  }

  private attachPageListeners(page: Page) {
    page.on('close', () => {
      if (this.page === page) this.page = null
    })
  }

  private validateUrl(raw: string): string {
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      throw new Error(`Invalid URL: ${raw}`)
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`Disallowed scheme: ${url.protocol}`)
    }
    if (!this.allowLocal) {
      const host = url.hostname
      if (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '::1' ||
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host)
      ) {
        throw new Error(`Local / private host blocked by config (allowLocal=false): ${host}`)
      }
    }
    return url.toString()
  }

  private async openUrl(raw: string, ctx: ExecutionContext): Promise<ToolResult> {
    const url = this.validateUrl(raw)
    const page = await this.ensurePage()
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    if (ctx.signal.aborted) return { success: false, error: 'aborted' }
    ctx.logger.info('opened', { url })
    return { success: true, data: { url, title: await page.title() } }
  }

  private async click(selector: string, ctx: ExecutionContext): Promise<ToolResult> {
    if (!selector) return { success: false, error: 'selector is required' }
    const page = await this.ensurePage()
    await page.locator(selector).first().click({ timeout: 10_000 })
    if (ctx.signal.aborted) return { success: false, error: 'aborted' }
    return { success: true, data: { selector } }
  }

  private async type(
    selector: string,
    text: string,
    pressEnter: boolean,
    ctx: ExecutionContext
  ): Promise<ToolResult> {
    if (!selector) return { success: false, error: 'selector is required' }
    const page = await this.ensurePage()
    const locator = page.locator(selector).first()
    await locator.fill(text, { timeout: 10_000 })
    if (pressEnter) await locator.press('Enter')
    if (ctx.signal.aborted) return { success: false, error: 'aborted' }
    return { success: true, data: { selector, pressEnter } }
  }

  private async pressKey(key: string, ctx: ExecutionContext): Promise<ToolResult> {
    if (!key) return { success: false, error: 'key is required' }
    const page = await this.ensurePage()
    await page.keyboard.press(key)
    if (ctx.signal.aborted) return { success: false, error: 'aborted' }
    return { success: true, data: { key } }
  }

  private async getText(ctx: ExecutionContext): Promise<ToolResult> {
    const page = await this.ensurePage()
    const raw = await page.evaluate(() => (document.body?.innerText ?? '').replace(/\s+\n/g, '\n'))
    if (ctx.signal.aborted) return { success: false, error: 'aborted' }
    return {
      success: true,
      data: {
        url: page.url(),
        title: await page.title(),
        text: truncate(raw, MAX_TEXT_CHARS),
        truncated: raw.length > MAX_TEXT_CHARS,
      },
    }
  }

  private async getA11yTree(ctx: ExecutionContext): Promise<ToolResult> {
    const page = await this.ensurePage()
    // Playwright >= 1.45 removed page.accessibility in favour of locator.ariaSnapshot(),
    // which returns a YAML-ish tree of interactive elements — good enough for an LLM.
    const snapshot = await page.locator('body').ariaSnapshot({ timeout: 10_000 })
    if (ctx.signal.aborted) return { success: false, error: 'aborted' }
    return {
      success: true,
      data: {
        url: page.url(),
        tree: truncate(snapshot, MAX_A11Y_CHARS),
        truncated: snapshot.length > MAX_A11Y_CHARS,
      },
    }
  }

  private async closeBrowser(ctx: ExecutionContext): Promise<ToolResult> {
    await this.dispose()
    ctx.logger.info('browser closed')
    return { success: true, data: { closed: true } }
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max) + `\n…[truncated ${s.length - max} chars]`
}
