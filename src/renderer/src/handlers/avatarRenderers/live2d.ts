import * as PIXI from 'pixi.js'
import { Live2DModel } from 'pixi-live2d-display/cubism4'
import { TYVoiceChatState } from '@renderer/interface/voiceChat'

// Register the Ticker so Live2DModel auto-updates each frame (idle/breath/blink
// motions etc.) without us having to pump it manually.
Live2DModel.registerTicker(PIXI.Ticker)

interface Live2DRendererOptions {
  container: HTMLDivElement
  assetsPath: string
  getChatState: () => TYVoiceChatState
  getExpressionData: () => Record<string, number> | null | undefined
  getAudioAnalyser?: () => { analyser: AnalyserNode; audioCtx: AudioContext } | null
  downloadProgress: (percent: number) => void
  loadProgress: (percent: number) => void
}

// ARKit-52 blendshape channel -> Cubism 4 parameter mapping.
// All source values are assumed to be in [0, 1].
interface ArkitFrame {
  jawOpen?: number
  mouthSmileLeft?: number
  mouthSmileRight?: number
  mouthFrownLeft?: number
  mouthFrownRight?: number
  mouthFunnel?: number
  mouthPucker?: number
  eyeBlinkLeft?: number
  eyeBlinkRight?: number
  eyeLookInLeft?: number
  eyeLookInRight?: number
  eyeLookOutLeft?: number
  eyeLookOutRight?: number
  eyeLookUpLeft?: number
  eyeLookUpRight?: number
  eyeLookDownLeft?: number
  eyeLookDownRight?: number
  browInnerUp?: number
  browOuterUpLeft?: number
  browOuterUpRight?: number
  browDownLeft?: number
  browDownRight?: number
  // Head rotation (not standard ARKit52, but some backends emit these)
  headYaw?: number
  headPitch?: number
  headRoll?: number
  [k: string]: number | undefined
}

const clamp = (v: number, min: number, max: number) => (v < min ? min : v > max ? max : v)

export class Live2DRenderer {
  private _container: HTMLDivElement
  private _assetsPath: string
  private _getChatState: () => TYVoiceChatState
  private _getExpressionData: () => Record<string, number> | null | undefined
  private _getAudioAnalyser?: () => { analyser: AnalyserNode; audioCtx: AudioContext } | null
  private _downloadProgress: (percent: number) => void
  private _loadProgress: (percent: number) => void

  private _canvas: HTMLCanvasElement | null = null
  private _app: PIXI.Application | null = null
  private _model: Live2DModel | null = null
  private _tickHandler: ((deltaTime: number) => void) | null = null
  // Attached to internalModel's `beforeModelUpdate` event — this is the ONLY
  // hook where user parameter overrides survive Live2D's per-frame reset +
  // motion/expression/physics/pose pipeline (see pixi-live2d-display
  // Cubism4InternalModel.update). Writing from a PIXI.Ticker callback runs
  // before _render, which then re-applies motions and clobbers our writes.
  private _beforeModelUpdateHandler: (() => void) | null = null
  private _disposed = false
  // Smoothed mouth open value (audio-driven), held across frames.
  private _mouthOpenSmoothed = 0
  // Scratch buffer reused each frame to avoid per-frame allocation.
  private _audioTimeBuf: Uint8Array | null = null

  constructor(options: Live2DRendererOptions) {
    this._container = options.container
    this._assetsPath = options.assetsPath
    this._getChatState = options.getChatState
    this._getExpressionData = options.getExpressionData
    this._getAudioAnalyser = options.getAudioAnalyser
    this._downloadProgress = options.downloadProgress
    this._loadProgress = options.loadProgress
  }

  async getInstance(): Promise<{ dispose: () => void }> {
    if (!this._assetsPath) {
      throw new Error('Live2DRenderer: assetsPath is required (pointing to *.model3.json)')
    }
    if (typeof (globalThis as any).Live2DCubismCore === 'undefined') {
      throw new Error(
        'Live2DRenderer: Live2DCubismCore is not loaded. Make sure live2dcubismcore.min.js is included in index.html.'
      )
    }

    this._canvas = document.createElement('canvas')
    this._canvas.style.width = '100%'
    this._canvas.style.height = '100%'
    this._canvas.style.display = 'block'
    this._container.appendChild(this._canvas)

    this._app = new PIXI.Application({
      view: this._canvas,
      resizeTo: this._container,
      autoStart: true,
      backgroundAlpha: 0,
      antialias: true,
    })

    // No native progress callback on Live2DModel.from — emit coarse-grained
    // progress so the outer UI still gets feedback.
    this._downloadProgress(0)
    this._loadProgress(0)

    this._model = await Live2DModel.from(this._assetsPath, { autoInteract: false })
    this._downloadProgress(100)

    if (this._disposed) {
      this._model.destroy()
      this._model = null
      return { dispose: () => this.dispose() }
    }

    this._app.stage.addChild(this._model as unknown as PIXI.DisplayObject)
    this._fitModelToStage()

    // Refit when the PIXI renderer resizes (container size change).
    this._app.renderer.on('resize', () => this._fitModelToStage())

    // Hook the model's internal update lifecycle. `beforeModelUpdate` fires
    // inside Cubism4InternalModel.update(), AFTER motions/expressions/physics
    // and BEFORE model.update() bakes parameters into drawables. This is the
    // only place user parameter overrides survive the per-frame pipeline.
    this._beforeModelUpdateHandler = () => this._applyParamsToModel()
    const internalEmitter = this._model.internalModel as unknown as {
      on: (event: string, listener: () => void) => void
      off?: (event: string, listener: () => void) => void
    }
    internalEmitter.on('beforeModelUpdate', this._beforeModelUpdateHandler)

    // PIXI ticker drives the smoothed mouth-open decay while idle so the next
    // response starts from a clean silence rather than the last value.
    this._tickHandler = () => this._onTick()
    PIXI.Ticker.shared.add(this._tickHandler)

    this._loadProgress(100)

    return { dispose: () => this.dispose() }
  }

  // Returns a smoothed [0, 1] mouth-open value derived from the currently
  // playing TTS audio via the Player's AnalyserNode. When no audio is active,
  // smoothly relaxes toward 0.
  private _computeAudioMouthOpen(): number {
    const analyserInfo = this._getAudioAnalyser?.()
    const analyser = analyserInfo?.analyser
    if (!analyser) {
      this._mouthOpenSmoothed *= 0.6
      return this._mouthOpenSmoothed
    }
    const size = analyser.fftSize
    if (!this._audioTimeBuf || this._audioTimeBuf.length !== size) {
      this._audioTimeBuf = new Uint8Array(size)
    }
    analyser.getByteTimeDomainData(this._audioTimeBuf as Uint8Array<ArrayBuffer>)
    let sumSq = 0
    for (let i = 0; i < size; i++) {
      const v = (this._audioTimeBuf[i] - 128) / 128
      sumSq += v * v
    }
    const rms = Math.sqrt(sumSq / size)
    // Typical speech RMS sits around 0.05-0.2. Map [noiseFloor, ceiling] -> [0, 1].
    const noiseFloor = 0.02
    const ceiling = 0.25
    let target = (rms - noiseFloor) / (ceiling - noiseFloor)
    if (target < 0) target = 0
    if (target > 1) target = 1
    // Asymmetric smoothing: fast attack (mouth opens quickly) and a somewhat
    // slower release so the lip flap matches syllables without chattering.
    const alpha = target > this._mouthOpenSmoothed ? 0.55 : 0.25
    this._mouthOpenSmoothed = this._mouthOpenSmoothed * (1 - alpha) + target * alpha
    return this._mouthOpenSmoothed
  }

  private _fitModelToStage(): void {
    if (!this._app || !this._model) return
    const { width, height } = this._app.renderer.screen
    const modelW = this._model.width || 1
    const modelH = this._model.height || 1
    // Fit so the model fills the available area while preserving aspect ratio,
    // anchored at the horizontal center and slightly above vertical center so
    // the face is visible.
    const scale = Math.min(width / modelW, height / modelH) * 0.95
    this._model.scale.set(scale)
    this._model.anchor.set(0.5, 0.5)
    this._model.position.set(width / 2, height / 2)
  }

  private _onTick(): void {
    if (!this._model || this._disposed) return
    // When NOT speaking we relax the audio-smoothed value back toward 0 so
    // the next response starts from silence. This is pure JS state (not a
    // coreModel write), so it's safe to do outside beforeModelUpdate.
    if (this._getChatState() !== TYVoiceChatState.Responding) {
      this._mouthOpenSmoothed *= 0.6
    }
  }

  // Applies all data-driven parameter overrides to the Cubism core model.
  // MUST be called from internalModel's `beforeModelUpdate` event — any other
  // call site (e.g. PIXI ticker) writes BEFORE Live2DModel._render() runs
  // internalModel.update(), whose motion/expression/physics pipeline then
  // clobbers our writes. See pixi-live2d-display cubism4.es.js:4970 and
  // Cubism4InternalModel.update (5416-5437).
  private _applyParamsToModel(): void {
    if (!this._model || this._disposed) return
    const core = (this._model.internalModel as unknown as { coreModel?: unknown }).coreModel as
      | { setParameterValueById: (id: string, value: number, weight?: number) => void }
      | undefined
    if (!core) return

    const state = this._getChatState()
    const frame = this._getExpressionData() as ArkitFrame | null | undefined
    const speaking = state === TYVoiceChatState.Responding

    if (!speaking) {
      core.setParameterValueById('ParamMouthOpenY', 0)
      return
    }

    // Mouth drive: primary signal is ARKit jawOpen (syllable-level detail),
    // boosted 8x because server peaks sit around 0.06-0.2 and need to map
    // near [0, 1]. Audio RMS is used as a floor so the mouth still tracks
    // speech energy if jawOpen is degenerate on a given frame.
    const jawBoost = clamp((frame?.jawOpen ?? 0) * 8, 0, 1)
    const audioRaw = this._computeAudioMouthOpen()
    const audioFloor = clamp(audioRaw * 1.2, 0, 1) * 0.5
    const mouthOpen = jawBoost > audioFloor ? jawBoost : audioFloor
    core.setParameterValueById('ParamMouthOpenY', mouthOpen)

    if (frame) applyArkitToCubism4(core, frame)
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    if (this._tickHandler) {
      PIXI.Ticker.shared.remove(this._tickHandler)
      this._tickHandler = null
    }
    if (this._beforeModelUpdateHandler && this._model) {
      const internalEmitter = this._model.internalModel as unknown as {
        off?: (event: string, listener: () => void) => void
      }
      internalEmitter.off?.('beforeModelUpdate', this._beforeModelUpdateHandler)
      this._beforeModelUpdateHandler = null
    }
    if (this._model) {
      try {
        this._model.destroy()
      } catch (e) {
        console.warn('Live2DRenderer: error destroying model', e)
      }
      this._model = null
    }
    if (this._app) {
      try {
        this._app.destroy(true, { children: true, texture: true, baseTexture: true })
      } catch (e) {
        console.warn('Live2DRenderer: error destroying pixi app', e)
      }
      this._app = null
    }
    if (this._canvas && this._canvas.parentNode === this._container) {
      this._container.removeChild(this._canvas)
    }
    this._canvas = null
  }
}

function applyArkitToCubism4(
  core: { setParameterValueById: (id: string, value: number, weight?: number) => void },
  f: ArkitFrame
): void {
  const set = (id: string, value: number, weight = 1) =>
    core.setParameterValueById(id, value, weight)

  // ---- Mouth ----
  // NOTE: ParamMouthOpenY is intentionally NOT written here. It is driven in
  // Live2DRenderer._applyParamsToModel from an 8x-boosted jawOpen with an
  // audio-RMS floor, so that syllable-level variation is visible and there is
  // a fallback when the server emits degenerate jawOpen.
  const smileL = f.mouthSmileLeft ?? 0
  const smileR = f.mouthSmileRight ?? 0
  const frownL = f.mouthFrownLeft ?? 0
  const frownR = f.mouthFrownRight ?? 0
  // ParamMouthForm is typically [-1, 1] on Cubism 4 models (Hiyori uses [0,1]
  // so we clamp; the renderer's param range metadata will cap it anyway).
  const mouthForm = clamp((smileL + smileR) / 2 - (frownL + frownR) / 2, -1, 1)
  set('ParamMouthForm', mouthForm)

  // ---- Eyes (blink) ----
  if (f.eyeBlinkLeft !== undefined) {
    set('ParamEyeLOpen', clamp(1 - f.eyeBlinkLeft, 0, 1))
  }
  if (f.eyeBlinkRight !== undefined) {
    set('ParamEyeROpen', clamp(1 - f.eyeBlinkRight, 0, 1))
  }

  // ---- Eyes (gaze) ----
  // ARKit semantics: InLeft = left-eye looking toward nose (right in screen).
  const lookX =
    ((f.eyeLookOutRight ?? 0) + (f.eyeLookInLeft ?? 0)) / 2 -
    ((f.eyeLookInRight ?? 0) + (f.eyeLookOutLeft ?? 0)) / 2
  const lookY =
    ((f.eyeLookUpLeft ?? 0) + (f.eyeLookUpRight ?? 0)) / 2 -
    ((f.eyeLookDownLeft ?? 0) + (f.eyeLookDownRight ?? 0)) / 2
  set('ParamEyeBallX', clamp(lookX, -1, 1))
  set('ParamEyeBallY', clamp(lookY, -1, 1))

  // ---- Brows ----
  if (f.browInnerUp !== undefined) {
    const v = clamp(f.browInnerUp, 0, 1)
    set('ParamBrowLY', v)
    set('ParamBrowRY', v)
  }
  const browDownL = f.browDownLeft ?? 0
  const browUpL = f.browOuterUpLeft ?? 0
  const browDownR = f.browDownRight ?? 0
  const browUpR = f.browOuterUpRight ?? 0
  set('ParamBrowLAngle', clamp(browUpL - browDownL, -1, 1))
  set('ParamBrowRAngle', clamp(browUpR - browDownR, -1, 1))

  // ---- Head rotation (only if backend provides it; otherwise leave to idle). ----
  if (f.headYaw !== undefined) {
    // ParamAngleX range is typically [-30, 30].
    set('ParamAngleX', clamp(f.headYaw * 30, -30, 30))
  }
  if (f.headPitch !== undefined) {
    set('ParamAngleY', clamp(f.headPitch * 30, -30, 30))
  }
  if (f.headRoll !== undefined) {
    set('ParamAngleZ', clamp(f.headRoll * 30, -30, 30))
  }
}
