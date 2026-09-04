// The `/v1/audio/transcriptions` shape, which is most of the world.
//
// One service definition covers OpenAI, Groq, and every local server that
// copied the same endpoint — whisper.cpp's `whisper-server`, Speaches, LocalAI,
// vLLM. That is why this is the first service built: it is simultaneously the
// paid option and the self-hosted option, and the only difference between them
// is a base URL.
//
// It is also why the recording is a WAV rather than webm/opus. The local
// servers are the ones least likely to have an opus decoder compiled in, and a
// transcription that fails because the container could not be read is not
// something the user can do anything about.

import { statusMessage, TranscriptionError, type TranscriptionRequest, type TranscriptionService } from '../types'

export const OPENAI_VOICE_URL_KEY = 'voice_openai_url'
export const OPENAI_VOICE_API_KEY = 'voice_openai_key'
export const OPENAI_DEFAULT_URL = 'https://api.openai.com/v1'

export interface BuiltRequest {
  url: string
  headers: Record<string, string>
  fields: Record<string, string>
}

/** Join a base URL to a path without doubling or dropping the slash between. */
export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

/**
 * Everything about the request except the bytes.
 *
 * Split out so a test can assert the URL, the headers and the multipart field
 * names without an audio device or a network — and in particular can assert
 * that **`Content-Type` is not set here**. `fetch` computes the multipart
 * boundary itself; setting the header by hand produces a boundary-less content
 * type, and the server answers with a 400 that says nothing about why.
 */
export function buildOpenAiRequest(
  keys: Record<string, string>, model: string, language: string,
): BuiltRequest {
  const base = keys[OPENAI_VOICE_URL_KEY]?.trim() || OPENAI_DEFAULT_URL
  const key = keys[OPENAI_VOICE_API_KEY]?.trim() ?? ''
  return {
    url: joinUrl(base, 'audio/transcriptions'),
    // A local server usually needs no key at all, so the header is omitted
    // rather than sent empty — some servers reject a malformed Authorization
    // header that they would have accepted the absence of.
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    fields: { model, ...(language ? { language } : {}) },
  }
}

/** Pull the text out, whatever shape of success or failure came back. */
export function parseOpenAiResponse(body: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    // whisper.cpp's server can be configured to answer in plain text.
    return body.trim()
  }
  const obj = parsed as { text?: unknown; error?: { message?: unknown } }
  if (typeof obj?.error?.message === 'string') throw new TranscriptionError(obj.error.message)
  return typeof obj?.text === 'string' ? obj.text.trim() : ''
}

export const openAiCompatibleService: TranscriptionService = {
  id: 'openai-compatible',
  label: 'OpenAI-compatible endpoint',
  kind: 'local-server',
  description:
    'Any server speaking /v1/audio/transcriptions — OpenAI and Groq, or one you run '
    + 'yourself (whisper.cpp, Speaches, LocalAI). Point it at a base URL.',
  streaming: false,
  urlKeyId: OPENAI_VOICE_URL_KEY,
  apiKeyId: OPENAI_VOICE_API_KEY,
  defaultUrl: OPENAI_DEFAULT_URL,
  models: [
    { id: 'whisper-1', label: 'whisper-1', note: 'OpenAI, and what most local servers answer to' },
    { id: 'gpt-4o-transcribe', label: 'gpt-4o-transcribe', note: 'OpenAI, more accurate' },
    { id: 'gpt-4o-mini-transcribe', label: 'gpt-4o-mini-transcribe', note: 'OpenAI, cheaper' },
    { id: 'whisper-large-v3-turbo', label: 'whisper-large-v3-turbo', note: 'Groq' },
  ],
  defaultModel: 'whisper-1',

  configError(keys) {
    const base = keys[OPENAI_VOICE_URL_KEY]?.trim() || OPENAI_DEFAULT_URL
    // Only the hosted endpoints need a key; a local server usually does not,
    // and demanding one would make the self-hosted case impossible to reach.
    const remote = /^https:\/\/api\./i.test(base)
    if (remote && !keys[OPENAI_VOICE_API_KEY]?.trim()) {
      return `${base} needs an API key. Add it in Settings → Voice input.`
    }
    return null
  },

  async transcribe(req: TranscriptionRequest): Promise<string> {
    const { url, headers, fields } = buildOpenAiRequest(req.keys, req.model, req.language)
    const res = await window.electronAPI.voice.transcribe({
      url, headers, fields,
      audio: req.wav(),
      filename: 'dictation.wav',
      mime: 'audio/wav',
    })
    if (!res.ok) throw new TranscriptionError(statusMessage(this.label, res.status, res.body))
    return parseOpenAiResponse(res.body)
  },
}
