// ============================================================
//  plugins/index.ts — Static plugin registration
// ============================================================
//
// We statically import every plugin (instead of scanning the
// filesystem) because electron-vite bundles the main process
// with externalizeDepsPlugin, and dynamic require()s against
// folders inside the bundle are unreliable.  Phase 3's hot
// reload will swap this for `import(url + '?t=' + Date.now())`.

import type { PluginRegistry } from '../core/plugin-registry'
import PotPlayerPlugin, { manifest as potplayerManifest } from './potplayer/index'
import BrowserVideoPlugin, { manifest as browserVideoManifest } from './browser-video/index'

export async function registerAll(registry: PluginRegistry): Promise<void> {
  registry.register(potplayerManifest as any, new PotPlayerPlugin())
  registry.register(browserVideoManifest as any, new BrowserVideoPlugin())
}
