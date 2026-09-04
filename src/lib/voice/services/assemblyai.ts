// AssemblyAI: three requests, not one.
//
// Upload the audio, ask for a transcript of it, then poll until the job is
// done. That shape is why this file is longer than the others, and why the
// polling is written as a pure state machine (`nextPoll`) with the sleeping
// left outside it — a test can then walk a job from queued to completed
// without waiting for anything.
//
// The upload takes the bytes as a raw body rather than a form part, so it goes
// through `voice:transcribe` with `raw: true`.

import {
  statusMessage, TranscriptionError,
  type TranscriptionRequest, type TranscriptionService,
} from '../types'

export const ASSEMBLYAI_API_KEY = 'voice_assemblyai_key'
const BASE = 'https://api.assemblyai.com/v2'

/** Their key is the bare `Authorization` value — no `Bearer`, no `Token`. */
export function assemblyHeaders(keys: Record<string, string>): Record<string, string> {
  return { Authorization: keys[ASSEMBLYAI_API_KEY]?.trim() ?? '' }
}

export function parseUploadUrl(body: string): string {
  const obj = JSON.parse(body) as { upload_url?: unknown; error?: unknown }
  if (typeof obj?.error === 'string') throw new TranscriptionError(obj.error)
  if (typeof obj?.upload_url !== 'string') {
    throw new TranscriptionError('AssemblyAI did not return an upload location.')
  }
  return obj.upload_url
}

export interface JobState {
  status: 'queued' | 'processing' | 'completed' | 'error' | 'unknown'
  text: string
  error: string | null
}

/** Read one poll response. Kept pure so the whole job lifecycle is testable. */
export function readJob(body: string): JobState {
  let parsed: unknown
  try { parsed = JSON.parse(body) } catch {
    return { status: 'unknown', text: '', error: 'AssemblyAI sent a reply that could not be read.' }
  }
  const obj = parsed as { status?: unknown; text?: unknown; error?: unknown }
  const status = typeof obj?.status === 'string' ? obj.status : 'unknown'
  return {
    status: (['queued', 'processing', 'completed', 'error'].includes(status)
      ? status : 'unknown') as JobState['status'],
    text: typeof obj?.text === 'string' ? obj.text.trim() : '',
    error: typeof obj?.error === 'string' ? obj.error : null,
  }
}

/**
 * How long to wait before asking again, given how long we have been waiting.
 *
 * Backs off so a slow job does not turn into a hundred requests, and stops
 * entirely at the ceiling rather than polling for ever — a dictation stuck in
 * "transcribing" with no end is worse than one that admits it gave up.
 */
export function nextPoll(elapsedMs: number): number | null {
  if (elapsedMs > 180_000) return null
  return elapsedMs < 5_000 ? 500 : elapsedMs < 30_000 ? 1_500 : 3_000
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export const assemblyAiService: TranscriptionService = {
  id: 'assemblyai',
  label: 'AssemblyAI',
  kind: 'cloud',
  description: 'Uploads the recording, then transcribes it. Strong on long, technical speech.',
  streaming: false,
  apiKeyId: ASSEMBLYAI_API_KEY,
  models: [
    { id: 'best', label: 'Best', note: 'Most accurate' },
    { id: 'nano', label: 'Nano', note: 'Cheaper, more languages' },
  ],
  defaultModel: 'best',

  configError(keys) {
    return keys[ASSEMBLYAI_API_KEY]?.trim()
      ? null
      : 'AssemblyAI needs an API key. Add it in Settings → Voice input.'
  },

  async transcribe(req: TranscriptionRequest): Promise<string> {
    const headers = assemblyHeaders(req.keys)

    const upload = await window.electronAPI.voice.transcribe({
      url: `${BASE}/upload`,
      headers,
      audio: req.wav(),
      filename: 'dictation.wav',
      mime: 'application/octet-stream',
      fields: {},
      raw: true,
    })
    if (!upload.ok) throw new TranscriptionError(statusMessage('AssemblyAI', upload.status, upload.body))
    const audioUrl = parseUploadUrl(upload.body)

    const created = await window.electronAPI.voice.request({
      url: `${BASE}/transcript`,
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audio_url: audioUrl,
        speech_model: req.model || 'best',
        ...(req.language ? { language_code: req.language } : { language_detection: true }),
      }),
    })
    if (!created.ok) throw new TranscriptionError(statusMessage('AssemblyAI', created.status, created.body))
    const id = (JSON.parse(created.body) as { id?: string }).id
    if (!id) throw new TranscriptionError('AssemblyAI did not start a transcription job.')

    const started = Date.now()
    for (;;) {
      if (req.signal.aborted) return ''
      const wait = nextPoll(Date.now() - started)
      if (wait === null) {
        throw new TranscriptionError('AssemblyAI is still working after three minutes — try a shorter recording.')
      }
      await sleep(wait)
      const poll = await window.electronAPI.voice.request({
        url: `${BASE}/transcript/${id}`, headers,
      })
      if (!poll.ok) throw new TranscriptionError(statusMessage('AssemblyAI', poll.status, poll.body))
      const job = readJob(poll.body)
      if (job.status === 'completed') return job.text
      if (job.status === 'error') {
        throw new TranscriptionError(job.error ?? 'AssemblyAI could not transcribe the recording.')
      }
    }
  },
}
