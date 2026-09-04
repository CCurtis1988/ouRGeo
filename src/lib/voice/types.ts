// What a transcription service is, from the panel's point of view.
//
// The shape follows `ApiProvider` and `LOCAL_PROVIDERS`: data describing the
// service, plus the one function that does the work. A service knows nothing
// about microphones, React or the composer — it is handed a finished WAV and
// returns text, which is what makes every one of them testable without an
// audio device.
//
// Streaming is deliberately NOT in this interface yet. Only two of the shipped
// services can stream, neither is built at the time of writing, and an
// abstraction designed around a transport nobody has implemented is a guess.
// It arrives as an optional `stream?()` alongside `transcribe`, so a batch
// service never has to pretend.

export type ServiceKind =
  /** Runs here, on the user's machine, over no network at all. */
  | 'on-device'
  /** An HTTP server the user runs — whisper.cpp, Speaches, LocalAI. */
  | 'local-server'
  /** Someone else's machine, over the internet, usually for money. */
  | 'cloud'

export interface ServiceModel {
  id: string
  label: string
  /** Size, speed or language, whichever the user needs to choose between them. */
  note?: string
}

export interface TranscriptionRequest {
  /** The recording as the microphone gave it: mono Float32 at 16 kHz. What the
   *  on-device engine wants, and what everything else is derived from. */
  samples: Float32Array
  /**
   * The same audio as a 16-bit PCM WAV, for the services that upload a file.
   *
   * A function rather than a value because the on-device engine never needs
   * it, and five minutes of speech is ten megabytes that would otherwise be
   * built and thrown away on every dictation.
   */
  wav: () => Uint8Array
  /** ISO-639-1 code, or '' to let the service detect it. */
  language: string
  model: string
  /** URLs and keys from `api-keys.json`, by the ids the service declares. */
  keys: Record<string, string>
  signal: AbortSignal
}

export interface TranscriptionService {
  id: string
  label: string
  kind: ServiceKind
  /** One line, shown under the picker — what it is and what it costs you. */
  description: string
  /** Whether this service will gain partial results in a later phase. */
  streaming: boolean
  /** `api-keys.json` id for the key, when it needs one. */
  apiKeyId?: string
  /** `api-keys.json` id for the base URL, when it has one. */
  urlKeyId?: string
  defaultUrl?: string
  models: ServiceModel[]
  defaultModel: string

  /**
   * Why this service cannot run yet, naming the field to fill in — or null
   * when it is ready. Checked before the microphone is opened, because
   * discovering a missing key *after* someone has dictated a paragraph loses
   * the paragraph.
   */
  configError(keys: Record<string, string>): string | null

  /** Audio in, text out. Rejects with a message the user can act on. */
  transcribe(req: TranscriptionRequest): Promise<string>
}

/** Thrown by a service when the request itself was refused, with a usable reason. */
export class TranscriptionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TranscriptionError'
  }
}

/**
 * Turn an HTTP status into a sentence that names the next move.
 *
 * Shared because every cloud service fails these three ways and a bare "500"
 * or "429" in the composer tells the user nothing they can do something about.
 */
export function statusMessage(service: string, status: number, body: string): string {
  const detail = body.trim().slice(0, 200)
  if (status === 401 || status === 403) {
    return `${service} rejected the API key. Check it in Settings → Voice input.`
  }
  if (status === 429) {
    return `${service} is rate-limiting requests — wait a moment and try again.`
  }
  if (status === 413) {
    return `The recording was too long for ${service}. Try a shorter one.`
  }
  return `${service} could not transcribe the recording (HTTP ${status})${detail ? `: ${detail}` : ''}.`
}
