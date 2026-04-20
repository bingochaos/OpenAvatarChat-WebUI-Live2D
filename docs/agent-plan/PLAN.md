# Implementation Plan

## Status overview

```
src/
├── core/
│   ├── types.ts              ✅ Done — all interfaces, EventBus, Logger
│   ├── plugin-registry.ts    ✅ Done — lifecycle, hot reload, timeouts
│   ├── agent.ts              ✅ Done — streaming, abort, retry
│   └── ipc-bridge.ts         ✅ Done — typed IPC channels
├── plugins/
│   ├── potplayer/
│   │   ├── manifest.json     ✅ Done (v1, carry forward)
│   │   └── index.ts          🔶 Needs update: add ExecutionContext param
│   └── browser-video/
│       ├── manifest.json     ✅ Done (v1, carry forward)
│       └── index.ts          🔶 Needs update: add ExecutionContext param
├── main.ts                   ✅ Done — bootstrap wiring
├── preload.ts                ❌ TODO
└── renderer/                 ❌ TODO
```


## Phase 1 — Patch existing plugins (0.5 day)

Update the two v1 plugin `execute()` signatures to accept
`ExecutionContext` as the third parameter.  Minimal changes:

### potplayer/index.ts

- [ ] Change `execute(toolName, input)` → `execute(toolName, input, ctx)`
- [ ] Use `ctx.signal` in `openFile` (abort waiting for window)
- [ ] Use `ctx.logger` instead of console.log
- [ ] Auto-detect PotPlayer path from Windows registry
      (`HKLM\SOFTWARE\DAUM\PotPlayer64` → `ProgramPath`)
      as fallback before using the config value

### browser-video/index.ts

- [ ] Change `execute(toolName, input)` → `execute(toolName, input, ctx)`
- [ ] Check `ctx.signal.aborted` before each Playwright action
- [ ] Use `ctx.logger` for all browser operation logs
- [ ] Add `browser_press_key` tool (for Escape, Tab, etc.)
- [ ] Add `browser_get_text` tool (extract visible text,
      cheaper than full a11y tree for simple lookups)
- [ ] Truncate a11y tree output to ~4000 chars to avoid
      blowing up Claude's context with huge pages
- [ ] Handle Playwright `page.close` / `context.close` events
      to prevent operating on dead pages


## Phase 2 — Preload + renderer skeleton (1 day)

### preload.ts

- [ ] Expose `electronAPI` on `window` via `contextBridge`
- [ ] Wrap all `ipcRenderer.invoke` calls with typed functions
- [ ] Set up `ipcRenderer.on` listeners for push events
      (`agent:event`, `plugin:state`) and return unsubscribe fns

### renderer/ (React + Tailwind + Vite)

Minimal feature set for first usable version:

- [ ] `App.tsx` — layout: chat panel (center) + sidebar (right)
- [ ] `ChatPanel.tsx` — message list + input box + send button
- [ ] `MessageBubble.tsx` — render text, tool_start/end blocks
- [ ] `ToolCallCard.tsx` — collapsible card showing tool name,
      input JSON, result, duration badge, success/error indicator
- [ ] `Sidebar.tsx` — plugin list with state dots (green/red/gray)
- [ ] `useAgent.ts` hook — manages message state, calls electronAPI,
      subscribes to push events, handles streaming text assembly
- [ ] Global "Stop" button → `electronAPI.abortAgent()`


## Phase 3 — Settings & config persistence (1 day)

- [ ] `electron-store` for: API key (encrypted), per-plugin configs,
      window bounds, conversation history (optional)
- [ ] `SettingsPanel.tsx` — dynamically renders config fields from
      each plugin's `getConfigSchema()` response
- [ ] API key input with show/hide toggle, validation on save
      (try a test API call)
- [ ] "Reload plugin" button per plugin (calls `plugins:reload`)


## Phase 4 — Production hardening (1-2 days)

- [ ] **Error boundaries** in renderer — catch React render crashes
- [ ] **Conversation export** — save/load chat as JSON
- [ ] **Token counting** — track approximate token usage per turn,
      show in UI, warn when approaching context limit
- [ ] **Conversation pruning** — when messages exceed ~80k tokens,
      summarize older messages before sending to API
- [ ] **Rate limiting** — debounce rapid send-button clicks,
      queue messages if agent is already running
- [ ] **Graceful degradation** — if all plugins are down, agent
      should still respond conversationally (just no tool calls)
- [ ] **Security**: validate URLs in browser plugin (no file://,
      no localhost unless explicitly allowed in config)


## Phase 5 — Packaging & distribution (1 day)

- [ ] `electron-builder` config (NSIS installer for Windows)
- [ ] `asarUnpack` for native modules: `koffi`, `playwright`
- [ ] Code signing (optional but recommended for SmartScreen)
- [ ] Auto-updater via `electron-updater` (point to GitHub Releases
      or custom update server)
- [ ] Bundle Playwright browser binary OR guide user to run
      `npx playwright install chromium` on first launch


## Phase 6 — Nice-to-haves (backlog)

- [ ] **Voice input** — Web Speech API in renderer, send transcript
      to agent (great for hands-free video control)
- [ ] **Global hotkey** — register a system-wide shortcut to
      activate the chat window (electron globalShortcut)
- [ ] **Plugin marketplace** — load plugins from a remote registry
      (npm-like), download into plugins/ on demand
- [ ] **Multi-tab browser** — browser plugin manages multiple tabs,
      add `browser_list_tabs` / `browser_switch_tab` tools
- [ ] **Bilibili login** — persist cookies so search results are
      personalized and age-restricted content is accessible
- [ ] **Clipboard integration** — paste video URLs from clipboard,
      auto-detect and offer to play in PotPlayer
- [ ] **Screenshot fallback** — when a11y tree is useless (Canvas
      sites), take a screenshot and use Claude's vision
- [ ] **MCP server mode** — expose the plugin system as an MCP
      server so other LLM clients (Claude Desktop, Cursor) can
      use your PotPlayer/browser tools directly


## Architecture decisions to make

1. **Plugin isolation**: Currently plugins run in the same Node
   process.  If a plugin crashes, it takes down the whole app.
   Consider spawning each plugin in a child process or worker
   thread.  Trade-off: complexity vs. stability.  Recommendation:
   keep in-process for v1, add isolation in v2 if needed.

2. **Browser plugin bundling**: Playwright downloads ~300MB of
   Chromium.  Options: (a) bundle it in the installer, (b) use
   system Chrome via `channel: 'chrome'`, (c) first-launch
   download.  Recommendation: (b) for dev, (a) for distribution.

3. **Context window management**: With browser a11y trees, context
   can grow fast.  Options: (a) hard-truncate tool results,
   (b) summarize old tool results, (c) sliding window.
   Recommendation: (a) truncate to 4k chars per tool result +
   (c) prune messages older than 10 rounds.

4. **Config format**: `electron-store` uses JSON.  If plugin
   configs get complex, consider YAML or TOML with a schema
   validator.  Recommendation: JSON is fine for v1.
