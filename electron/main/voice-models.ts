import type { IpcMain, WebContents } from 'electron'
import { app, protocol } from 'electron'
import { createReadStream } from 'fs'
import { mkdir, rename, rm, stat, writeFile } from 'fs/promises'
import { createHash } from 'crypto'
import { join, dirname, normalize, sep } from 'path'
import { Readable } from 'stream'

// The on-device speech model: downloading it, storing it, and serving it back
// to the renderer.
//
// Three facts drive the whole design.
//
// 1. The packaged renderer runs from `file://`, where the browser Cache API is
//    unavailable — so transformers.js' own caching cannot work, and without
//    something in its place the model would be re-downloaded every launch.
// 2. The models are tens to hundreds of megabytes. Handing them to the
//    renderer as base64 over IPC would mean a ~330 MB string for the largest,
//    copied twice before onnxruntime ever sees it.
// 3. transformers.js will happily fetch from any URL its process can reach.
//
// So the files are downloaded here, kept under userData, and served over a
// privileged `ourgeo-model://` scheme that `protocol.handle` streams from
// disk. The renderer points `env.localModelPath` at it and turns remote models
// off; transformers.js' own request logic then works unmodified, streamed, and
// with no IPC round trip for the weights at all.

export interface WhisperModelFile {
  path: string
  bytes: number
  /** sha256, for the LFS weights. The small config files are plain git blobs
   *  and Hugging Face exposes no sha256 for them; their size is the check. */
  sha256?: string
}

export interface WhisperModel {
  id: string
  repo: string
  /** A commit, never a branch: a model that silently changes underneath a
   *  cached copy is a bug nobody can reproduce. */
  revision: string
  label: string
  note: string
  multilingual: boolean
  totalBytes: number
  files: WhisperModelFile[]
}

export const WHISPER_MODELS: WhisperModel[] = [
  {
    id: 'tiny.en',
    repo: 'onnx-community/whisper-tiny.en',
    revision: '2575352d61be',
    label: 'Tiny · English',
    note: 'Fastest, roughest on names and jargon',
    multilingual: false,
    totalBytes: 45081321,
    files: [
      { path: 'config.json', bytes: 2197 },
      { path: 'generation_config.json', bytes: 1646 },
      { path: 'preprocessor_config.json', bytes: 339 },
      { path: 'tokenizer.json', bytes: 2405679 },
      { path: 'tokenizer_config.json', bytes: 282662 },
      { path: 'vocab.json', bytes: 999186 },
      { path: 'merges.txt', bytes: 456318 },
      { path: 'added_tokens.json', bytes: 34604 },
      { path: 'normalizer.json', bytes: 52666 },
      { path: 'special_tokens_map.json', bytes: 2173 },
      { path: 'onnx/encoder_model_quantized.onnx', bytes: 10124993 },
      { path: 'onnx/decoder_model_merged_quantized.onnx', bytes: 30718858 },
    ],
  },
  {
    id: 'base.en',
    repo: 'onnx-community/whisper-base.en',
    revision: '51eefc0af78b',
    label: 'Base · English',
    note: 'A good default — comfortably faster than real time',
    multilingual: false,
    totalBytes: 81131503,
    files: [
      { path: 'config.json', bytes: 2197 },
      { path: 'generation_config.json', bytes: 1556 },
      { path: 'preprocessor_config.json', bytes: 339 },
      { path: 'tokenizer.json', bytes: 2405679 },
      { path: 'tokenizer_config.json', bytes: 282662 },
      { path: 'vocab.json', bytes: 999186 },
      { path: 'merges.txt', bytes: 456318 },
      { path: 'added_tokens.json', bytes: 34604 },
      { path: 'normalizer.json', bytes: 52666 },
      { path: 'special_tokens_map.json', bytes: 2173 },
      { path: 'onnx/encoder_model_quantized.onnx', bytes: 23201320 },
      { path: 'onnx/decoder_model_merged_quantized.onnx', bytes: 53692803 },
    ],
  },
  {
    id: 'small.en',
    repo: 'onnx-community/whisper-small.en',
    revision: '482fb8ba081b',
    label: 'Small · English',
    note: 'Best on technical vocabulary; slow without WebGPU',
    multilingual: false,
    totalBytes: 253314032,
    files: [
      { path: 'config.json', bytes: 2203 },
      { path: 'generation_config.json', bytes: 1956 },
      { path: 'preprocessor_config.json', bytes: 339 },
      { path: 'tokenizer.json', bytes: 2405679 },
      { path: 'tokenizer_config.json', bytes: 282662 },
      { path: 'vocab.json', bytes: 999186 },
      { path: 'merges.txt', bytes: 456318 },
      { path: 'added_tokens.json', bytes: 34604 },
      { path: 'normalizer.json', bytes: 52666 },
      { path: 'special_tokens_map.json', bytes: 2173 },
      { path: 'onnx/encoder_model_quantized.onnx', bytes: 92326170 },
      { path: 'onnx/decoder_model_merged_quantized.onnx', bytes: 156750076 },
    ],
  },
  {
    id: 'base',
    repo: 'onnx-community/whisper-base',
    revision: '1846881b6b3a',
    label: 'Base · Multilingual',
    note: '~99 languages, slightly weaker English',
    multilingual: true,
    totalBytes: 81284108,
    files: [
      { path: 'config.json', bytes: 2243 },
      { path: 'generation_config.json', bytes: 3832 },
      { path: 'preprocessor_config.json', bytes: 339 },
      { path: 'tokenizer.json', bytes: 2480466 },
      { path: 'tokenizer_config.json', bytes: 282682 },
      { path: 'vocab.json', bytes: 1036584 },
      { path: 'merges.txt', bytes: 493869 },
      { path: 'added_tokens.json', bytes: 34604 },
      { path: 'normalizer.json', bytes: 52666 },
      { path: 'special_tokens_map.json', bytes: 2194 },
      { path: 'onnx/encoder_model_quantized.onnx', bytes: 23201314 },
      { path: 'onnx/decoder_model_merged_quantized.onnx', bytes: 53693315 },
    ],
  },
  {
    id: 'small',
    repo: 'onnx-community/whisper-small',
    revision: '36050c46d777',
    label: 'Small · Multilingual',
    note: '~99 languages, best accuracy; slow without WebGPU',
    multilingual: true,
    totalBytes: 253466530,
    files: [
      { path: 'config.json', bytes: 2227 },
      { path: 'generation_config.json', bytes: 3893 },
      { path: 'preprocessor_config.json', bytes: 339 },
      { path: 'tokenizer.json', bytes: 2480466 },
      { path: 'tokenizer_config.json', bytes: 282683 },
      { path: 'vocab.json', bytes: 1036584 },
      { path: 'merges.txt', bytes: 493869 },
      { path: 'added_tokens.json', bytes: 34604 },
      { path: 'normalizer.json', bytes: 52666 },
      { path: 'special_tokens_map.json', bytes: 2194 },
      { path: 'onnx/encoder_model_quantized.onnx', bytes: 92326160 },
      { path: 'onnx/decoder_model_merged_quantized.onnx', bytes: 156750845 },
    ],
  },
]


export interface ModelStatus {
  id: string
  label: string
  note: string
  multilingual: boolean
  totalBytes: number
  installed: boolean
  /** Bytes already on disk, so a half-finished download can say how far it got. */
  bytesOnDisk: number
}

const MODEL_SCHEME = 'ourgeo-model'

function modelsDir(): string {
  return join(app.getPath('userData'), 'voice-models')
}

function modelById(id: string): WhisperModel | undefined {
  return WHISPER_MODELS.find((m) => m.id === id)
}

/**
 * Resolve a request path inside the models directory, refusing anything that
 * climbs out of it.
 *
 * The same guard `plugins.ts` uses on its own directory. The renderer is not
 * hostile, but a URL is user-influenced input and `..` in one must never reach
 * the filesystem.
 */
function contain(relative: string): string {
  const root = modelsDir()
  const target = normalize(join(root, relative))
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error('Path outside the voice-models directory')
  }
  return target
}

async function fileBytes(path: string): Promise<number> {
  return stat(path).then((s) => s.size).catch(() => 0)
}

/** Is every file present at its expected size? Disk is the only truth here —
 *  a "downloaded" flag in a preferences file goes stale the moment someone
 *  clears the directory by hand. */
async function installedBytes(model: WhisperModel): Promise<number> {
  let total = 0
  for (const f of model.files) {
    total += await fileBytes(join(modelsDir(), model.id, f.path))
  }
  return total
}

async function isInstalled(model: WhisperModel): Promise<boolean> {
  for (const f of model.files) {
    if (await fileBytes(join(modelsDir(), model.id, f.path)) !== f.bytes) return false
  }
  return true
}

export async function modelStatuses(): Promise<ModelStatus[]> {
  const out: ModelStatus[] = []
  for (const m of WHISPER_MODELS) {
    out.push({
      id: m.id, label: m.label, note: m.note, multilingual: m.multilingual,
      totalBytes: m.totalBytes,
      installed: await isInstalled(m),
      bytesOnDisk: await installedBytes(m),
    })
  }
  return out
}

const downloads = new Map<string, AbortController>()

function send(wc: WebContents, channel: string, payload: unknown): void {
  if (!wc.isDestroyed()) wc.send(channel, payload)
}

async function downloadFile(
  model: WhisperModel, file: WhisperModelFile, signal: AbortSignal,
  onBytes: (delta: number) => void,
): Promise<void> {
  const target = join(modelsDir(), model.id, file.path)
  if (await fileBytes(target) === file.bytes) { onBytes(file.bytes); return }

  await mkdir(dirname(target), { recursive: true })
  const url = `https://huggingface.co/${model.repo}/resolve/${model.revision}/${file.path}`
  const res = await fetch(url, { signal })
  if (!res.ok || !res.body) throw new Error(`${file.path}: HTTP ${res.status}`)

  // Written to `.part` and renamed only once verified, so an interrupted
  // download can never be mistaken for a finished one on the next launch.
  const part = `${target}.part`
  const chunks: Buffer[] = []
  const hash = file.sha256 ? createHash('sha256') : null
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    const buf = Buffer.from(chunk)
    chunks.push(buf)
    hash?.update(buf)
    onBytes(buf.length)
  }
  const body = Buffer.concat(chunks)

  if (body.length !== file.bytes) {
    throw new Error(`${file.path}: expected ${file.bytes} bytes, got ${body.length}`)
  }
  if (hash) {
    const digest = hash.digest('hex')
    if (digest !== file.sha256) throw new Error(`${file.path}: checksum did not match`)
  }
  await writeFile(part, body)
  await rename(part, target)
}

export function registerVoiceModelHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('voice:models', () => modelStatuses())

  ipcMain.handle('voice:modelDownload', async (event, id: string): Promise<{ ok: boolean; error?: string }> => {
    const model = modelById(id)
    if (!model) return { ok: false, error: `No model called "${id}".` }
    if (downloads.has(id)) return { ok: false, error: 'That model is already downloading.' }

    const controller = new AbortController()
    downloads.set(id, controller)
    let done = 0
    try {
      for (const file of model.files) {
        await downloadFile(model, file, controller.signal, (delta) => {
          done += delta
          send(event.sender, `voice:modelProgress:${id}`, {
            received: done, total: model.totalBytes, file: file.path,
          })
        })
      }
      return { ok: true }
    } catch (err) {
      const aborted = controller.signal.aborted
      // A cancelled download leaves its .part files; the next attempt skips
      // whatever completed, so cancelling is not the same as starting again.
      return {
        ok: false,
        error: aborted
          ? 'Download cancelled.'
          : `The model could not be downloaded: ${err instanceof Error ? err.message : String(err)}`,
      }
    } finally {
      downloads.delete(id)
    }
  })

  ipcMain.handle('voice:modelCancel', (_e, id: string): boolean => {
    const controller = downloads.get(id)
    if (!controller) return false
    controller.abort()
    return true
  })

  ipcMain.handle('voice:modelRemove', async (_e, id: string): Promise<boolean> => {
    if (!modelById(id)) return false
    downloads.get(id)?.abort()
    await rm(join(modelsDir(), id), { recursive: true, force: true })
    return true
  })
}

/**
 * Serve the downloaded weights to the renderer.
 *
 * Registered as a privileged scheme (before `app.whenReady`, which Electron
 * requires) so it counts as a secure origin that `fetch` can read — and
 * streamed rather than read into memory, because the largest single file here
 * is 150 MB.
 */
export function registerVoiceModelProtocol(): void {
  protocol.handle(MODEL_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      // ourgeo-model://models/<id>/<file>. The host names the store rather
      // than being part of the path — joining it in would put every file under
      // an extra `models/` directory that nothing writes to.
      if (url.hostname !== 'models') return new Response('Not found', { status: 404 })
      const target = contain(decodeURIComponent(url.pathname))
      const size = await fileBytes(target)
      if (size === 0) return new Response('Not found', { status: 404 })
      return new Response(Readable.toWeb(createReadStream(target)) as ReadableStream, {
        headers: { 'Content-Length': String(size), 'Content-Type': 'application/octet-stream' },
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

/** Declared before `app.whenReady()`; see `registerVoiceModelProtocol`. */
export const VOICE_MODEL_SCHEME_PRIVILEGES = {
  scheme: MODEL_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}
