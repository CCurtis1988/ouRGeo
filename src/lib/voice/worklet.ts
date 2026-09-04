// The audio worklet: the only code in ouRGeo that runs on the audio thread.
//
// It does three things and nothing else — resample to 16 kHz, measure the
// level, and post fixed-size frames back — because everything on this thread
// runs under a hard real-time deadline (128 samples, every ~2.7 ms at 48 kHz)
// and a missed deadline is an audible glitch in the recording.
//
// The source is a STRING rather than a module file. A worklet is loaded by URL,
// and the packaged renderer runs from `file://` where there is no origin to
// resolve a relative URL against; a blob URL sidesteps that and is already
// permitted by the CSP (`worker-src blob:` — a worklet request has destination
// `worker`, not `script`, so it is `worker-src` that governs it, not
// `script-src`).

import { TARGET_SAMPLE_RATE } from './audio'

/** 20 ms at 16 kHz — the frame size the streaming services expect. */
export const FRAME_SAMPLES = 320

export const PROCESSOR_NAME = 'ourgeo-voice-capture'

/**
 * What comes back over the port, once per frame (50 Hz) rather than once per
 * render quantum (375 Hz at 48 kHz). A meter cannot show 375 updates a second
 * and the message traffic is not free, so the level reported is the PEAK over
 * the frame — a peak is also what makes a meter feel responsive, where a mean
 * would smooth away exactly the transient that tells you the mic is live.
 */
export interface VoiceFrameMessage {
  level: number
  frame: Float32Array
}

const PROCESSOR_SOURCE = `
class OurgeoVoiceCapture extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const opts = options.processorOptions || {}
    this.ratio = sampleRate / (opts.targetRate || ${TARGET_SAMPLE_RATE})
    this.frameSize = opts.frameSize || ${FRAME_SAMPLES}
    this.out = new Float32Array(this.frameSize)
    this.outIndex = 0
    this.peak = 0
    // Fractional read position into the current quantum. It goes negative at a
    // quantum boundary, which is how an interpolation that straddles the
    // boundary reaches back to the previous quantum's last sample.
    this.pos = 0
    this.prev = 0
  }

  process(inputs) {
    const input = inputs[0]
    const ch = input && input[0]
    // No input yet (or the track ended). Staying alive keeps the node ready
    // for the stream to resume rather than tearing the graph down.
    if (!ch || ch.length === 0) return true

    let pos = this.pos
    const ratio = this.ratio
    // Stop one sample short: interpolating the last position needs the NEXT
    // quantum's first sample, which does not exist yet. It is picked up on the
    // following call through the negative carry.
    while (pos + 1 < ch.length) {
      const i0 = Math.floor(pos)
      const t = pos - i0
      const s0 = i0 < 0 ? this.prev : ch[i0]
      const s1 = ch[i0 + 1]
      const sample = s0 * (1 - t) + s1 * t

      const abs = sample < 0 ? -sample : sample
      if (abs > this.peak) this.peak = abs

      this.out[this.outIndex++] = sample
      if (this.outIndex === this.frameSize) {
        const frame = this.out
        this.out = new Float32Array(this.frameSize)
        this.outIndex = 0
        // Transferred, not copied: the audio thread must not be waiting on a
        // structured clone of every frame.
        this.port.postMessage({ level: this.peak, frame }, [frame.buffer])
        this.peak = 0
      }
      pos += ratio
    }

    this.prev = ch[ch.length - 1]
    this.pos = pos - ch.length
    return true
  }
}

registerProcessor('${PROCESSOR_NAME}', OurgeoVoiceCapture)
`

/**
 * Register the processor on a context, returning a disposer for the blob URL.
 *
 * The URL is revoked once `addModule` resolves — it has been fetched by then,
 * and a blob URL left alive pins its contents in memory for the life of the
 * document.
 */
export async function addCaptureWorklet(context: AudioContext): Promise<void> {
  const url = URL.createObjectURL(new Blob([PROCESSOR_SOURCE], { type: 'application/javascript' }))
  try {
    await context.audioWorklet.addModule(url)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Exposed for the test that pins the resampling maths. */
export const __PROCESSOR_SOURCE = PROCESSOR_SOURCE
