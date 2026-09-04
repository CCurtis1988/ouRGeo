// Whisper, running here, over no network at all.
//
// This is the service that makes voice input work with no account, no key and
// no server — and the reason the feature can be turned on by someone who would
// never paste an API key into a desktop application.
//
// Three things about it are worth knowing before changing anything.
//
// **transformers.js is imported dynamically and is a devDependency.** It
// declares `onnxruntime-node` (296 MB unpacked) and `sharp`, and this repo
// ships production `node_modules` inside the asar — so as a runtime dependency
// it would have added ~440 MB to every installer, for every user, including
// those who never dictate. As a devDependency, Vite bundles only the browser
// half it actually imports, as a lazy chunk nothing else loads.
//
// **The weights are not bundled at all.** They are downloaded on first use by
// the main process and served back over `ourgeo-model://` (see
// `electron/main/voice-models.ts`). `env.allowRemoteModels = false` is what
// guarantees the promise made in the UI: once the model is on disk, dictation
// touches the network never again.
//
// **WebGPU is tried first, wasm second.** The wasm backend is single-threaded
// here, because multi-threading needs `SharedArrayBuffer` and therefore
// cross-origin isolation, and enabling COEP globally would gate the basemap
// tiles and every other cross-origin subresource the app already loads. So the
// larger models are genuinely slow without WebGPU, and the model picker says
// so rather than letting someone discover it after a 240 MB download.

import { TranscriptionError, type TranscriptionRequest, type TranscriptionService } from '../types'

/** Where `protocol.handle` serves the downloaded weights from. */
const MODEL_BASE = 'ourgeo-model://models/'

type Transcriber = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text?: string }>

let loaded: { model: string; device: string; run: Transcriber } | null = null
let loading: Promise<{ model: string; device: string; run: Transcriber }> | null = null

/** Which backend the loaded model is actually using, for Settings to report. */
export function activeDevice(): string | null {
  return loaded?.device ?? null
}

/** Drop the loaded model — after it is removed from disk, or swapped. */
export function unloadWhisper(): void {
  loaded = null
  loading = null
}

async function load(model: string): Promise<{ model: string; device: string; run: Transcriber }> {
  if (loaded?.model === model) return loaded
  if (loading) return loading

  loading = (async () => {
    const { pipeline, env } = await import('@huggingface/transformers')
    env.allowRemoteModels = false
    env.allowLocalModels = true
    env.localModelPath = MODEL_BASE

    // WebGPU first, wasm second, and explicitly rather than through an 'auto'
    // that would swallow the reason. Which one won is shown in Settings,
    // because it is the difference between comfortable and unusable on the
    // larger models.
    for (const device of ['webgpu', 'wasm'] as const) {
      try {
        const run = await pipeline('automatic-speech-recognition', model, {
          device, dtype: 'q8',
        }) as unknown as Transcriber
        const ready = { model, device, run }
        loaded = ready
        return ready
      } catch (err) {
        if (device === 'wasm') {
          throw new TranscriptionError(
            `The speech model could not be loaded: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }
    throw new TranscriptionError('The speech model could not be loaded.')
  })()

  try {
    return await loading
  } finally {
    loading = null
  }
}

export const BUILTIN_WHISPER_ID = 'builtin-whisper'

export const builtinWhisperService: TranscriptionService = {
  id: BUILTIN_WHISPER_ID,
  label: 'On this machine (Whisper)',
  kind: 'on-device',
  description:
    'Runs on your computer. Nothing is uploaded and no account is needed. '
    + 'The model is downloaded once, then works offline.',
  streaming: false,
  // The models are managed by the downloader rather than typed in, so the list
  // here stays empty and Settings shows the model manager instead.
  models: [],
  defaultModel: 'base.en',

  configError() {
    // Whether a model is downloaded is a question for the filesystem, and this
    // check is synchronous. The panel asks `window.electronAPI.voice.models()`
    // before it starts, and offers the picker — see `VoiceButton`.
    return null
  },

  async transcribe(req: TranscriptionRequest): Promise<string> {
    const { run } = await load(req.model || 'base.en')
    if (req.signal.aborted) return ''
    const out = await run(req.samples, {
      // Whisper is trained on 30-second windows; anything longer has to be
      // chunked or it is silently truncated to the first 30 seconds.
      chunk_length_s: 30,
      stride_length_s: 5,
      ...(req.language ? { language: req.language, task: 'transcribe' } : {}),
    })
    return typeof out?.text === 'string' ? out.text.trim() : ''
  },
}
