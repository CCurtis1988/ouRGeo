import { create } from 'zustand'
import type { InputDevice } from '@/lib/voice/devices'
import {
  loadVoicePreferences, saveVoicePreferences, VOICE_DEFAULTS,
} from '@/lib/voice-preferences-persistence'

/**
 * What the mic control is doing. A discriminated status rather than a handful
 * of booleans, because `isRecording && isTranscribing` is a state the UI would
 * have to decide how to draw and which can never actually happen.
 */
export type VoiceStatus = 'idle' | 'starting' | 'listening' | 'transcribing' | 'error'

interface VoiceState {
  status: VoiceStatus
  /**
   * Live input level, 0–1, written ~50 times a second.
   *
   * **Never select this in a component.** A `useVoiceStore((s) => s.level)`
   * anywhere re-renders that component fifty times a second for the whole of a
   * dictation. The meter reads it with `useVoiceStore.getState().level` inside
   * a `requestAnimationFrame` loop and writes the transform to the DOM node
   * directly; nothing about the level belongs in React's render path.
   */
  level: number
  /** Seconds recorded so far, for the timer. Updated about once a second. */
  seconds: number
  /** Message naming the recovery move; shown in the composer. */
  error: string | null
  /** Text a streaming service has offered but not committed to. */
  partial: string
  devices: InputDevice[]
  /** Ids of the on-device models actually present on disk. Read from the
   *  filesystem via IPC, never remembered in a preferences file — a
   *  "downloaded" flag goes stale the moment someone clears the directory. */
  installedModels: string[]

  // Preferences, mirrored from voice-preferences.json.
  serviceId: string
  deviceId: string
  modelByService: Record<string, string>
  language: string
  autoSend: boolean
  silenceStopMs: number

  setStatus: (status: VoiceStatus, error?: string | null) => void
  setLevel: (level: number, seconds: number) => void
  setPartial: (partial: string) => void
  setDevices: (devices: InputDevice[]) => void
  refreshModels: () => Promise<void>
  setService: (id: string) => void
  setDevice: (id: string) => void
  setModel: (serviceId: string, model: string) => void
  setLanguage: (language: string) => void
  setAutoSend: (on: boolean) => void
  setSilenceStopMs: (ms: number) => void
  init: () => Promise<void>
}

export const useVoiceStore = create<VoiceState>((set, get) => ({
  status: 'idle',
  level: 0,
  seconds: 0,
  error: null,
  partial: '',
  devices: [],
  installedModels: [],

  serviceId: VOICE_DEFAULTS.serviceId,
  deviceId: VOICE_DEFAULTS.deviceId,
  modelByService: VOICE_DEFAULTS.modelByService,
  language: VOICE_DEFAULTS.language,
  autoSend: VOICE_DEFAULTS.autoSend,
  silenceStopMs: VOICE_DEFAULTS.silenceStopMs,

  setStatus: (status, error = null) => set({ status, error, ...(status === 'idle' ? { level: 0, seconds: 0, partial: '' } : {}) }),
  setLevel: (level, seconds) => set({ level, seconds }),
  setPartial: (partial) => set({ partial }),
  setDevices: (devices) => set({ devices }),
  refreshModels: async () => {
    const models = await window.electronAPI.voice.models().catch(() => [])
    set({ installedModels: models.filter((m) => m.installed).map((m) => m.id) })
  },

  setService: (serviceId) => { set({ serviceId }); void saveVoicePreferences({ serviceId }) },
  setDevice: (deviceId) => { set({ deviceId }); void saveVoicePreferences({ deviceId }) },
  setModel: (serviceId, model) => {
    const modelByService = { ...get().modelByService, [serviceId]: model }
    set({ modelByService })
    void saveVoicePreferences({ modelByService })
  },
  setLanguage: (language) => { set({ language }); void saveVoicePreferences({ language }) },
  setAutoSend: (autoSend) => { set({ autoSend }); void saveVoicePreferences({ autoSend }) },
  setSilenceStopMs: (silenceStopMs) => {
    set({ silenceStopMs })
    void saveVoicePreferences({ silenceStopMs })
  },

  init: async () => {
    const prefs = await loadVoicePreferences()
    set(prefs)
  },
}))
