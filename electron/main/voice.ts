import type { IpcMain } from 'electron'

// Uploading a recording to a transcription service.
//
// This does not go through `ai-proxy.ts`, and that is deliberate. That module's
// `ProxyRequest.body` is a string, shaped for JSON chat bodies streamed back as
// SSE; carrying audio through it would mean either base64 inflation inside a
// JSON-typed field or widening a hot, already-subtle path for the one caller
// that needs something else. A transcription is one request and one JSON
// response — none of the streaming machinery applies.
//
// It runs in main for the same reason every other outbound call here does: the
// renderer keeps `webSecurity` on, and CORS would refuse most of these
// endpoints from a `file://` origin. Building the multipart body here also
// means using Node's own `FormData`, rather than hand-rolling boundaries.

export interface VoiceTranscribeRequest {
  url: string
  headers: Record<string, string>
  /** The WAV itself. A `Uint8Array` crosses IPC by structured clone, the way
   *  `forum:uploadImage` already sends image bytes — no base64 inflation. */
  audio: Uint8Array
  filename: string
  mime: string
  /** Extra multipart text fields: model, language, and whatever else. */
  fields: Record<string, string>
  /** Some services take the audio as a raw body rather than a form part. */
  raw?: boolean
  timeoutMs?: number
}

export interface VoiceTranscribeResult {
  ok: boolean
  status: number
  body: string
}

/** Generous: a five-minute recording against a busy local server is slow, and
 *  a timeout that fires while the server is still working looks to the user
 *  exactly like a service that does not work. */
const DEFAULT_TIMEOUT_MS = 120_000

export function registerVoiceHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('voice:transcribe', async (
    _event, req: VoiceTranscribeRequest,
  ): Promise<VoiceTranscribeResult> => {
    const signal = AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    const audio = Buffer.from(req.audio)

    let body: FormData | Buffer
    if (req.raw) {
      body = audio
    } else {
      const form = new FormData()
      form.append('file', new Blob([audio], { type: req.mime }), req.filename)
      for (const [k, v] of Object.entries(req.fields)) form.append(k, v)
      body = form
    }

    try {
      const res = await fetch(req.url, {
        method: 'POST',
        // No Content-Type when the body is a FormData: `fetch` computes the
        // multipart boundary itself, and setting the header by hand produces a
        // boundary-less content type the server rejects with a puzzling 400.
        headers: req.raw ? { ...req.headers, 'Content-Type': req.mime } : req.headers,
        body,
        signal,
      })
      return { ok: res.ok, status: res.status, body: await res.text() }
    } catch (err) {
      const name = (err as { name?: string })?.name
      if (name === 'TimeoutError' || name === 'AbortError') {
        return { ok: false, status: 0, body: 'The transcription service did not respond in time.' }
      }
      return {
        ok: false,
        status: 0,
        body: err instanceof Error ? err.message : String(err),
      }
    }
  })

  // A plain GET, for a service that has to be asked something before it can
  // transcribe (AssemblyAI polls a job; a local server is asked what models it
  // has). Same reasons it lives in main as the upload above.
  ipcMain.handle('voice:request', async (
    _event, req: { url: string; method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<VoiceTranscribeResult> => {
    try {
      const res = await fetch(req.url, {
        method: req.method ?? 'GET',
        headers: req.headers,
        body: req.body,
        signal: AbortSignal.timeout(30_000),
      })
      return { ok: res.ok, status: res.status, body: await res.text() }
    } catch (err) {
      return { ok: false, status: 0, body: err instanceof Error ? err.message : String(err) }
    }
  })
}
