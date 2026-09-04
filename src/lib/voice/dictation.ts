// One dictation, from arming the microphone to text in the composer.
//
// The panel calls `startDictation` and `stopDictation` and is otherwise not
// involved: everything about which service, which device, when to stop and
// what went wrong lives here, so the same dictation can later be started from
// somewhere other than the AI panel without any of it moving.
//
// Rule 0 does not bind — none of this runs R, so there is no R to echo. Its
// corollary does: a recording sent to a service that is not on this machine is
// a network call the user should be able to see afterwards, so it goes in the
// console the way `describeWebCall` records every web tool call.

import { encodeWav } from './audio'
import { CaptureError, VoiceCapture, type CaptureEnd } from './capture'
import { INITIAL_SILENCE, silenceStep, heardSpeech, type SilenceState } from './silence'
import { resolveService } from './registry'
import { TranscriptionError } from './types'
import { useVoiceStore } from '@/store/voice'
import { useApiKeysStore } from '@/store/apiKeys'
import { useSessionStore } from '@/store/session'

export interface DictationHandlers {
  /** A finished transcript, ready to go into the composer. */
  onTranscript: (text: string) => void
  /** Nothing was heard — worth saying, because the usual cause is the wrong
   *  microphone rather than the user having said nothing. */
  onNothingHeard?: () => void
}

const capture = new VoiceCapture()
let silence: SilenceState = INITIAL_SILENCE
let handlers: DictationHandlers | null = null
let abort: AbortController | null = null
let stopping = false

/** What the console records when audio leaves this machine. */
export function describeVoiceCall(service: string, url: string, seconds: number): string {
  const host = (() => { try { return new URL(url).host } catch { return url } })()
  return `[Voice] sent ${seconds.toFixed(1)}s of audio to ${service}${host ? ` (${host})` : ''}`
}

function log(text: string): void {
  useSessionStore.getState().addConsoleEntry('info', text)
}

function fail(message: string): void {
  useVoiceStore.getState().setStatus('error', message)
}

export function isDictating(): boolean {
  return capture.active
}

export async function startDictation(next: DictationHandlers): Promise<void> {
  const store = useVoiceStore.getState()
  if (capture.active || store.status === 'transcribing') return

  const service = resolveService(store.serviceId)
  const keys = useApiKeysStore.getState().keys

  // Checked before the microphone opens rather than after: finding out that a
  // key is missing once someone has dictated a paragraph loses the paragraph.
  const configError = service.configError(keys)
  if (configError) { fail(configError); return }

  handlers = next
  silence = INITIAL_SILENCE
  stopping = false
  store.setStatus('starting')

  // macOS answers 'denied' without ever opening the microphone, and the
  // getUserMedia rejection that follows cannot tell the user which of three
  // settings panes to open.
  const access = await window.electronAPI.voice.micAccess().catch(() => 'granted')
  if (access === 'denied' || access === 'restricted') {
    fail('macOS is blocking the microphone for ouRGeo. Open System Settings → Privacy & Security → Microphone, turn it on, then try again.')
    return
  }

  try {
    await capture.start(store.deviceId || undefined, {
      onLevel: (level) => {
        const s = useVoiceStore.getState()
        s.setLevel(level, capture.seconds)
        silence = silenceStep(silence, level, performance.now(), {
          threshold: 0.02,
          trailingMs: s.silenceStopMs,
        })
        if (silence.phase === 'stopped') void stopDictation()
      },
      onFrame: () => { /* streaming services consume these in a later phase */ },
      onEnd: (reason) => void finishAfterEnd(reason),
    })
    useVoiceStore.getState().setStatus('listening')
  } catch (err) {
    fail(err instanceof CaptureError ? err.message : 'The microphone could not be started.')
  }
}

/** Capture stopped by itself — device lost, or the length cap. */
async function finishAfterEnd(reason: CaptureEnd): Promise<void> {
  if (reason === 'device-lost') {
    log('[Voice] the microphone was disconnected — transcribing what was recorded')
  }
  await transcribeWhatWeHave()
}

export async function stopDictation(): Promise<void> {
  if (stopping || !capture.active) return
  await transcribeWhatWeHave()
}

async function transcribeWhatWeHave(): Promise<void> {
  if (stopping) return
  stopping = true
  const store = useVoiceStore.getState()
  const samples = await capture.stop()

  if (!heardSpeech(silence) || samples.length === 0) {
    store.setStatus('idle')
    handlers?.onNothingHeard?.()
    return
  }

  store.setStatus('transcribing')
  const service = resolveService(store.serviceId)
  const keys = useApiKeysStore.getState().keys
  const seconds = samples.length / 16000
  abort = new AbortController()

  try {
    if (service.kind !== 'on-device') {
      log(describeVoiceCall(service.label, keys[service.urlKeyId ?? ''] ?? service.defaultUrl ?? '', seconds))
    }
    const text = await service.transcribe({
      samples,
      wav: () => encodeWav(samples),
      language: store.language,
      model: store.modelByService[service.id] ?? service.defaultModel,
      keys,
      signal: abort.signal,
    })
    if (!text.trim()) {
      useVoiceStore.getState().setStatus('idle')
      handlers?.onNothingHeard?.()
      return
    }
    useVoiceStore.getState().setStatus('idle')
    handlers?.onTranscript(text.trim())
  } catch (err) {
    fail(err instanceof TranscriptionError
      ? err.message
      : `The recording could not be transcribed: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    abort = null
  }
}

/** Throw the recording away — the user changed their mind. */
export async function cancelDictation(): Promise<void> {
  stopping = true
  abort?.abort()
  await capture.cancel()
  useVoiceStore.getState().setStatus('idle')
}
