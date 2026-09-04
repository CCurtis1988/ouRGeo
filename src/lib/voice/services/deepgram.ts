// Deepgram: the one that shows words while you are still saying them.
//
// It speaks WebSocket, and the socket is opened from the RENDERER rather than
// relayed through the main process. Two reasons: `src/lib/ws-client.ts` already
// opens one there, and the API key is already renderer-side for every provider
// in this application (`api-keys.json`, read by `useApiKeysStore`). A main-
// process relay would need a `ws` dependency the repo does not have, to protect
// a secret the renderer is already holding.
//
// A browser `WebSocket` cannot set headers, which is why the key travels as a
// subprotocol — the form Deepgram's own browser guidance uses. Their ephemeral
// `/v1/auth/grant` tokens would be better if the key were kept in main; while
// it is not, minting one would be ceremony rather than security.

import {
  statusMessage, TranscriptionError,
  type StreamOptions, type StreamSession, type TranscriptionRequest, type TranscriptionService,
} from '../types'
import { TARGET_SAMPLE_RATE } from '../audio'

export const DEEPGRAM_API_KEY = 'voice_deepgram_key'
const WS_BASE = 'wss://api.deepgram.com/v1/listen'
const REST_BASE = 'https://api.deepgram.com/v1/listen'

/** The query Deepgram needs to interpret raw PCM frames off the wire. */
export function deepgramParams(model: string, language: string, streaming: boolean): string {
  const params = new URLSearchParams({
    model: model || 'nova-3',
    encoding: 'linear16',
    sample_rate: String(TARGET_SAMPLE_RATE),
    channels: '1',
    punctuate: 'true',
    smart_format: 'true',
  })
  // Interim results are the whole point of the streaming path; asking for them
  // on the REST endpoint is meaningless and Deepgram rejects unknown pairs.
  if (streaming) params.set('interim_results', 'true')
  if (language) params.set('language', language)
  return params.toString()
}

export interface DeepgramResult {
  transcript: string
  isFinal: boolean
}

/**
 * Read one socket message.
 *
 * Deepgram sends metadata, keep-alives and errors down the same socket as
 * results, so anything that is not a transcript returns null rather than being
 * mistaken for an empty one — an empty transcript is a real answer that would
 * otherwise wipe the interim text the user is watching.
 */
export function readDeepgramMessage(raw: string): DeepgramResult | null {
  let msg: unknown
  try { msg = JSON.parse(raw) } catch { return null }
  const obj = msg as {
    type?: string
    is_final?: boolean
    channel?: { alternatives?: { transcript?: unknown }[] }
  }
  if (obj?.type !== 'Results') return null
  const transcript = obj.channel?.alternatives?.[0]?.transcript
  if (typeof transcript !== 'string') return null
  return { transcript, isFinal: obj.is_final === true }
}

/** Injected by the test, which drives the whole state machine with a fake
 *  socket rather than a network. */
export type SocketFactory = (url: string, protocols: string[]) => WebSocket
let socketFactory: SocketFactory = (url, protocols) => new WebSocket(url, protocols)

export function setSocketFactory(factory: SocketFactory): void { socketFactory = factory }

/** Frames are 20 ms; ten seconds of them is a generous ceiling for a socket
 *  that has not finished opening yet. */
const MAX_QUEUED_FRAMES = 500

export const deepgramService: TranscriptionService = {
  id: 'deepgram',
  label: 'Deepgram',
  kind: 'cloud',
  description: 'Fast and accurate, and the only shipped service that shows words as you speak.',
  streaming: true,
  apiKeyId: DEEPGRAM_API_KEY,
  models: [
    { id: 'nova-3', label: 'Nova 3', note: 'Latest, best on technical vocabulary' },
    { id: 'nova-2', label: 'Nova 2', note: 'Cheaper' },
  ],
  defaultModel: 'nova-3',

  configError(keys) {
    return keys[DEEPGRAM_API_KEY]?.trim()
      ? null
      : 'Deepgram needs an API key. Add it in Settings → Voice input.'
  },

  async transcribe(req: TranscriptionRequest): Promise<string> {
    const key = req.keys[DEEPGRAM_API_KEY]?.trim() ?? ''
    const res = await window.electronAPI.voice.transcribe({
      url: `${REST_BASE}?${deepgramParams(req.model, req.language, false)}`,
      headers: { Authorization: `Token ${key}` },
      audio: req.wav(),
      filename: 'dictation.wav',
      mime: 'audio/wav',
      fields: {},
      // Deepgram's REST endpoint takes the audio as the body, not a form part.
      raw: true,
    })
    if (!res.ok) throw new TranscriptionError(statusMessage('Deepgram', res.status, res.body))
    return parseDeepgramRest(res.body)
  },

  async openStream(opts: StreamOptions): Promise<StreamSession> {
    const key = opts.keys[DEEPGRAM_API_KEY]?.trim() ?? ''
    const url = `${WS_BASE}?${deepgramParams(opts.model, opts.language, true)}`
    const socket = socketFactory(url, ['token', key])
    socket.binaryType = 'arraybuffer'

    let finalText = ''
    let queued: Int16Array[] = []
    let open = false
    let closed = false
    let settle: ((text: string) => void) | null = null
    let failed: ((err: Error) => void) | null = null

    socket.onopen = () => {
      open = true
      for (const frame of queued) socket.send(frame.buffer as ArrayBuffer)
      queued = []
    }
    socket.onmessage = (e: MessageEvent) => {
      const result = readDeepgramMessage(typeof e.data === 'string' ? e.data : '')
      if (!result) return
      if (result.isFinal) {
        if (result.transcript) finalText = `${finalText} ${result.transcript}`.trim()
        opts.onPartial(finalText)
      } else if (result.transcript) {
        // Interim text is shown appended to what is already settled, never
        // written into the composer — it is about to be replaced.
        opts.onPartial(`${finalText} ${result.transcript}`.trim())
      }
    }
    socket.onerror = () => {
      // The event carries no detail by design; the close code that follows is
      // where any reason will be.
      if (!closed) failed?.(new TranscriptionError(
        'The connection to Deepgram failed. Check the API key and your network.'))
    }
    socket.onclose = (e: CloseEvent) => {
      closed = true
      if (settle) { settle(finalText); return }
      // 1000 is a clean close; anything else before `finish` means we lost it.
      if (e.code !== 1000 && failed) {
        failed(new TranscriptionError(
          `Deepgram closed the connection (${e.code}${e.reason ? `: ${e.reason}` : ''}).`))
      }
    }

    return {
      push(frame: Int16Array) {
        if (closed) return
        if (!open) {
          // Dropping the oldest is better than growing without bound if the
          // socket never opens; the recording is still transcribed by the
          // batch fallback in that case.
          if (queued.length >= MAX_QUEUED_FRAMES) queued.shift()
          queued.push(frame)
          return
        }
        socket.send(frame.buffer as ArrayBuffer)
      },
      finish() {
        return new Promise<string>((resolve, reject) => {
          if (closed) { resolve(finalText); return }
          settle = resolve
          failed = reject
          // Ask for whatever is still buffered on their side, then let the
          // close handler resolve. Without the timeout a socket that never
          // answers would hang the dictation in "transcribing" for ever.
          try { socket.send(JSON.stringify({ type: 'CloseStream' })) } catch { /* already gone */ }
          setTimeout(() => { if (!closed) { closed = true; resolve(finalText) } }, 5000)
        })
      },
      abort() {
        closed = true
        settle = null
        failed = null
        try { socket.close() } catch { /* already gone */ }
      },
    }
  },
}

/** The REST endpoint nests its answer two levels deeper than the socket does. */
export function parseDeepgramRest(body: string): string {
  let parsed: unknown
  try { parsed = JSON.parse(body) } catch { throw new TranscriptionError('Deepgram sent a reply that could not be read.') }
  const obj = parsed as {
    err_msg?: unknown
    results?: { channels?: { alternatives?: { transcript?: unknown }[] }[] }
  }
  if (typeof obj?.err_msg === 'string') throw new TranscriptionError(obj.err_msg)
  const transcript = obj?.results?.channels?.[0]?.alternatives?.[0]?.transcript
  return typeof transcript === 'string' ? transcript.trim() : ''
}
