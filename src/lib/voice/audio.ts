// Turning microphone samples into the two things a transcription service wants.
//
// Everything here is pure arithmetic over typed arrays: no AudioContext, no
// DOM, no Electron. That is deliberate — this is the half of the capture path
// that can be wrong in ways you cannot see or hear (a WAV header off by four
// bytes, a sample rate written little-endian in the wrong field, clipping at
// the extremes), so it is the half that gets tested.
//
// One PCM path serves every service: the on-device engine wants Float32 at
// 16 kHz, the batch HTTP services want a WAV file, and the streaming services
// want PCM16 frames. All three are derived from the same samples rather than
// captured three different ways.

/**
 * What every transcription service in the registry expects, and what Whisper
 * was trained on. Resampling to it happens once, in the capture worklet, so
 * nothing downstream has to ask what rate it is holding.
 */
export const TARGET_SAMPLE_RATE = 16000

/** Mean square root of a frame — the number the mic meter draws. */
export function rms(frame: Float32Array): number {
  if (frame.length === 0) return 0
  let sum = 0
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
  return Math.sqrt(sum / frame.length)
}

/**
 * Float samples in [-1, 1] to signed 16-bit.
 *
 * The asymmetry is not a typo: two's complement gives one more step below zero
 * than above it, so full-scale negative is −32768 and full-scale positive is
 * 32767. Scaling both by 32768 would wrap the loudest positive sample round to
 * the most negative one — an audible click at exactly the moment someone
 * speaks up.
 */
export function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]))
    out[i] = Math.round(s < 0 ? s * 0x8000 : s * 0x7fff)
  }
  return out
}

/**
 * Linear resampling, used to get whatever rate the device runs at down to
 * `TARGET_SAMPLE_RATE`.
 *
 * Linear rather than a windowed sinc: the input is speech being handed to a
 * recogniser, not audio anyone will listen to, and the aliasing a better
 * filter would remove sits above the band Whisper and every other model in the
 * registry actually use.
 */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to || input.length === 0) return input
  const ratio = from / to
  const outLength = Math.floor(input.length / ratio)
  const out = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const t = pos - i0
    out[i] = input[i0] * (1 - t) + input[i1] * t
  }
  return out
}

/** Concatenate the frames a recording accumulated into one buffer. */
export function concatFrames(frames: Float32Array[]): Float32Array {
  let total = 0
  for (const f of frames) total += f.length
  const out = new Float32Array(total)
  let offset = 0
  for (const f of frames) { out.set(f, offset); offset += f.length }
  return out
}

/** Seconds of audio a buffer holds, for the recording timer and the length cap. */
export function durationSeconds(samples: Float32Array, sampleRate = TARGET_SAMPLE_RATE): number {
  return sampleRate > 0 ? samples.length / sampleRate : 0
}

const HEADER_BYTES = 44

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
}

/**
 * A canonical 16-bit mono PCM WAV.
 *
 * WAV rather than the webm/opus a MediaRecorder would have produced, because
 * every batch service in the registry accepts it — including the local servers
 * (whisper.cpp, Speaches, LocalAI), which are the ones most likely to have no
 * opus decoder built in. It is bigger on the wire and that is the right trade:
 * a minute of speech is under 2 MB, and a transcription that fails because the
 * server could not decode the container is not recoverable by the user.
 *
 * Every multi-byte field is little-endian — the `true` third argument on each
 * `set*` call. RIFF is a little-endian format and a big-endian sample rate
 * yields a file that opens, plays as noise, and transcribes as nothing.
 */
export function encodeWav(samples: Float32Array, sampleRate = TARGET_SAMPLE_RATE): Uint8Array {
  const pcm = floatToPcm16(samples)
  const dataBytes = pcm.length * 2
  const buffer = new ArrayBuffer(HEADER_BYTES + dataBytes)
  const view = new DataView(buffer)

  writeAscii(view, 0, 'RIFF')
  // Everything after this field: the 4-byte "WAVE" tag, the 24-byte fmt chunk
  // and the 8-byte data header, plus the samples.
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(view, 8, 'WAVE')

  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)          // PCM fmt chunk length
  view.setUint16(20, 1, true)           // format 1 = uncompressed PCM
  view.setUint16(22, 1, true)           // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)  // byte rate: rate × block align
  view.setUint16(32, 2, true)           // block align: one 16-bit sample
  view.setUint16(34, 16, true)          // bits per sample

  writeAscii(view, 36, 'data')
  view.setUint32(40, dataBytes, true)
  for (let i = 0; i < pcm.length; i++) view.setInt16(HEADER_BYTES + i * 2, pcm[i], true)

  return new Uint8Array(buffer)
}
