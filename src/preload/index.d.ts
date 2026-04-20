import { ElectronAPI } from '@electron-toolkit/preload'

// The authoritative ElectronAgentAPI shape lives in
// src/renderer/src/interface/agent.ts.  We keep a loose typing here
// to avoid pulling renderer-only files into the preload tsconfig.
type AnyFn = (...args: any[]) => any

declare global {
  interface Window {
    electron: ElectronAPI
    api: unknown
    electronInfo: { version: string; platform: string }
    safeApi: { fetch: (url: string, options?: RequestInit) => Promise<unknown> }
    electronAgent: Record<string, AnyFn>
  }
}

export {}
