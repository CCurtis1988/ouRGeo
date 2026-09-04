import { createJsonFileStore } from '@/lib/persistence'
import { DEFAULT_SERVICE_ID } from '@/lib/voice/registry'

const store = createJsonFileStore('voice-preferences.json', 'Voice Prefs')

export interface VoicePreferences {
  /** Which transcription service, by registry id. */
  serviceId: string
  /** `deviceId` from `enumerateDevices`; '' means the system default. */
  deviceId: string
  /** Per service, because a Whisper model id means nothing to Deepgram. */
  modelByService: Record<string, string>
  /** ISO-639-1, or '' to let the service detect it. */
  language: string
  /** Send the message as soon as the transcript arrives. Off by default: an
   *  assistant that can run R should not be handed a misheard instruction. */
  autoSend: boolean
  /** Quiet after speech before stopping on the user's behalf. 0 disables it. */
  silenceStopMs: number
}

const DEFAULTS: VoicePreferences = {
  serviceId: DEFAULT_SERVICE_ID,
  deviceId: '',
  modelByService: {},
  language: '',
  autoSend: false,
  silenceStopMs: 1500,
}

/**
 * Read the file, defending every field.
 *
 * Same shape as `loadAiPreferences`: a hand-edited or half-written file must
 * degrade field by field, not all at once — losing the chosen microphone
 * because `autoSend` was mistyped would be a poor trade.
 */
export async function loadVoicePreferences(): Promise<VoicePreferences> {
  const data = await store.read<Partial<Record<keyof VoicePreferences, unknown>>>()
  const models = data.modelByService
  return {
    serviceId: typeof data.serviceId === 'string' && data.serviceId
      ? data.serviceId : DEFAULTS.serviceId,
    deviceId: typeof data.deviceId === 'string' ? data.deviceId : DEFAULTS.deviceId,
    modelByService: typeof models === 'object' && models !== null
      ? Object.fromEntries(
          Object.entries(models as Record<string, unknown>)
            .filter(([, v]) => typeof v === 'string'))  as Record<string, string>
      : {},
    language: typeof data.language === 'string' ? data.language : DEFAULTS.language,
    autoSend: typeof data.autoSend === 'boolean' ? data.autoSend : DEFAULTS.autoSend,
    // A negative or absurd timeout would either never stop or stop instantly;
    // both read as a broken microphone rather than a bad setting.
    silenceStopMs: typeof data.silenceStopMs === 'number'
      && data.silenceStopMs >= 0 && data.silenceStopMs <= 30_000
      ? data.silenceStopMs : DEFAULTS.silenceStopMs,
  }
}

export async function saveVoicePreferences(patch: Partial<VoicePreferences>): Promise<void> {
  await store.merge(patch as Record<string, unknown>)
}

export const VOICE_DEFAULTS: VoicePreferences = DEFAULTS
