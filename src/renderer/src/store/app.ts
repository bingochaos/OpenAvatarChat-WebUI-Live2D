import { message } from 'ant-design-vue'
import { defineStore } from 'pinia'

import { initConfig, makeURL } from '@/apis'
import { useMediaStore } from './media'
import { TextPayload } from '@renderer/interface/eventType'

type ChatRecord = {
  id: string
  role: 'human' | 'avatar'
  message: string
  cancelled?: boolean
  invalid?: boolean
} & TextPayload

// Entry describing a Cubism 4 Live2D model that can be loaded by the renderer.
// The manifest at public/live2d/models.json is the source of truth at runtime;
// adding a new model only requires dropping files under public/live2d/<id>/
// and registering it in that JSON file — no code change needed.
export interface Live2dModelEntry {
  id: string
  label: string
  path: string
}

const LIVE2D_MODEL_STORAGE_KEY = 'avatar.live2d.modelId'
const LIVE2D_MANIFEST_URL = './live2d/models.json'
// Fallback manifest used when the manifest fetch fails (offline / dev error).
const DEFAULT_LIVE2D_MODELS: Live2dModelEntry[] = [
  { id: 'hiyori', label: 'Hiyori (桃瀬ひより)', path: './live2d/hiyori/Hiyori.model3.json' },
]

interface AppState {
  avatarType: '' | 'lam' | 'live2d'
  avatarWSRoute: string
  wsSessionRoute: string
  avatarAssetsPath: string
  // All Live2D models advertised by public/live2d/models.json.
  live2dModels: Live2dModelEntry[]
  // Currently selected model id (matches an entry in live2dModels.id).
  selectedLive2dModelId: string
  rtcConfig: RTCConfiguration | undefined
  chatMode: 'webrtc' | 'ws'
  chatRecords: ChatRecord[]

  toolsVisible: boolean
  inputVisible: boolean
}

export const useAppStore = defineStore('appStore', {
  state: (): AppState => ({
    avatarType: '',
    avatarWSRoute: '',
    wsSessionRoute: '',
    avatarAssetsPath: '',
    live2dModels: [],
    selectedLive2dModelId: '',
    rtcConfig: undefined,
    chatMode: 'webrtc',
    chatRecords: [],
    toolsVisible: true,
    inputVisible: true,
  }),
  actions: {
    async init() {
      const mediaStore = useMediaStore()
      return initConfig()
        .then((res) => res.json())
        .then(async (config) => {
          if (config.detail) {
            message.error(config.detail)
            return
          }
          if (config.rtc_configuration) {
            this.rtcConfig = config.rtc_configuration
          }
          if (config.chat_mode) {
            this.chatMode = config.chat_mode === 'ws' ? 'ws' : 'webrtc'
          }
          config.avatar_config = config.avatar_config || {}
          if (config.avatar_config) {
            this.avatarType = config.avatar_config.avatar_type || ''
            this.avatarWSRoute = config.avatar_config.avatar_ws_route || ''
            this.avatarAssetsPath = config.avatar_config.avatar_assets_path
              ? makeURL(config.avatar_config.avatar_assets_path)
              : ''
            if (config.avatar_config.ws_session_route) {
              this.wsSessionRoute = config.avatar_config.ws_session_route
              if (!this.avatarWSRoute) {
                this.avatarWSRoute = config.avatar_config.ws_session_route
              }
            }
          }
          if (config.ws_session_route) {
            this.wsSessionRoute = config.ws_session_route
            if (!this.avatarWSRoute) {
              this.avatarWSRoute = config.ws_session_route
            }
          }
          if (config.track_constraints) {
            mediaStore.setTrackConstraints(config.track_constraints)
          }

          // Front-end override of avatarType via Vite env var. Backend is not
          // required to know about 'live2d' — toggling VITE_AVATAR_TYPE in
          // .env is enough to switch renderer on the client.
          const envType = import.meta.env.VITE_AVATAR_TYPE as string | undefined
          if (envType === 'lam' || envType === 'live2d' || envType === '') {
            this.avatarType = envType as AppState['avatarType']
          }

          // When running in live2d mode, load the local model manifest so the
          // user can switch between multiple bundled Cubism 4 models. The
          // `avatar_assets_path` provided by the backend targets LAM assets
          // and is ignored in this mode.
          if (this.avatarType === 'live2d') {
            await this.loadLive2dManifest()
          }
        })
        .catch((e) => {
          message.error(
            `服务端链接失败，请检查是否能正确访问到 OpenAvatarChat 服务端: ${e instanceof Error ? e.message : String(e)}`
          )
        })
    },
    async loadLive2dManifest() {
      let models: Live2dModelEntry[] = []
      try {
        const res = await fetch(LIVE2D_MANIFEST_URL, { cache: 'no-cache' })
        if (res.ok) {
          const data = (await res.json()) as { models?: Live2dModelEntry[] }
          if (Array.isArray(data.models) && data.models.length) {
            models = data.models.filter((m) => m && m.id && m.path)
          }
        }
      } catch (e) {
        console.warn('Failed to load live2d manifest, falling back to defaults', e)
      }
      if (!models.length) models = DEFAULT_LIVE2D_MODELS
      this.live2dModels = models
      // Preferred pick: VITE_LIVE2D_MODEL_URL takes top priority (hardcoded
      // override for CI/dev); otherwise the last user selection from
      // localStorage; otherwise the first manifest entry.
      const envOverride = (import.meta.env.VITE_LIVE2D_MODEL_URL as string | undefined) || ''
      if (envOverride) {
        this.selectedLive2dModelId = ''
        this.avatarAssetsPath = envOverride
        return
      }
      const stored =
        (typeof localStorage !== 'undefined' && localStorage.getItem(LIVE2D_MODEL_STORAGE_KEY)) ||
        ''
      const pick = models.find((m) => m.id === stored) || models[0]
      this.selectedLive2dModelId = pick.id
      this.avatarAssetsPath = pick.path
    },
    selectLive2dModel(id: string): boolean {
      const pick = this.live2dModels.find((m) => m.id === id)
      if (!pick) return false
      if (pick.id === this.selectedLive2dModelId) return false
      this.selectedLive2dModelId = pick.id
      this.avatarAssetsPath = pick.path
      try {
        localStorage.setItem(LIVE2D_MODEL_STORAGE_KEY, pick.id)
      } catch {
        // localStorage may be disabled (private mode); ignore.
      }
      return true
    },
    resetChatRecords() {
      this.chatRecords = []
    },
  },
})
