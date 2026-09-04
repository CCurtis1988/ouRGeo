// ElevenLabs Scribe.
//
// The simplest of the cloud services: one multipart POST, one JSON answer. It
// differs from the OpenAI shape in two ways that matter — the key travels in
// an `xi-api-key` header rather than a bearer token, and the model field is
// `model_id` rather than `model`. Both are the kind of detail that produces a
// 400 with no explanation, which is why the request builder is a pure function
// with a test on it.

import {
  statusMessage, TranscriptionError,
  type TranscriptionRequest, type TranscriptionService,
} from '../types'

export const ELEVENLABS_API_KEY = 'voice_elevenlabs_key'
const ENDPOINT = 'https://api.elevenlabs.io/v1/speech-to-text'

export function buildElevenLabsRequest(
  keys: Record<string, string>, model: string, language: string,
): { url: string; headers: Record<string, string>; fields: Record<string, string> } {
  return {
    url: ENDPOINT,
    headers: { 'xi-api-key': keys[ELEVENLABS_API_KEY]?.trim() ?? '' },
    fields: {
      model_id: model || 'scribe_v1',
      // Their field is an ISO-639-1 code under a different name again; sending
      // an empty one is not the same as omitting it.
      ...(language ? { language_code: language } : {}),
    },
  }
}

export function parseElevenLabsResponse(body: string): string {
  let parsed: unknown
  try { parsed = JSON.parse(body) } catch { throw new TranscriptionError('ElevenLabs sent a reply that could not be read.') }
  const obj = parsed as { text?: unknown; detail?: { message?: unknown } | string }
  if (typeof obj?.detail === 'string') throw new TranscriptionError(obj.detail)
  if (obj?.detail && typeof (obj.detail as { message?: unknown }).message === 'string') {
    throw new TranscriptionError((obj.detail as { message: string }).message)
  }
  return typeof obj?.text === 'string' ? obj.text.trim() : ''
}

export const elevenLabsService: TranscriptionService = {
  id: 'elevenlabs',
  label: 'ElevenLabs Scribe',
  kind: 'cloud',
  description: 'Accurate on accents and noisy recordings. Transcribes a finished clip.',
  streaming: false,
  apiKeyId: ELEVENLABS_API_KEY,
  models: [
    { id: 'scribe_v1', label: 'Scribe v1' },
    { id: 'scribe_v1_experimental', label: 'Scribe v1 experimental' },
  ],
  defaultModel: 'scribe_v1',

  configError(keys) {
    return keys[ELEVENLABS_API_KEY]?.trim()
      ? null
      : 'ElevenLabs needs an API key. Add it in Settings → Voice input.'
  },

  async transcribe(req: TranscriptionRequest): Promise<string> {
    const { url, headers, fields } = buildElevenLabsRequest(req.keys, req.model, req.language)
    const res = await window.electronAPI.voice.transcribe({
      url, headers, fields,
      audio: req.wav(),
      filename: 'dictation.wav',
      mime: 'audio/wav',
    })
    if (!res.ok) throw new TranscriptionError(statusMessage('ElevenLabs', res.status, res.body))
    return parseElevenLabsResponse(res.body)
  },
}
