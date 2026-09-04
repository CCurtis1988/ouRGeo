// Holding the microphone open, and letting go of it.
//
// The single most important property of this module is that the microphone is
// released on EVERY exit path — a normal stop, a cancel, an error mid-start, a
// device unplugged, the panel unmounting. A recording indicator left burning
// in the system tray after a user thinks they have finished dictating is the
// worst failure this feature has available to it, worse than a transcription
// that never arrives, because it is a privacy failure and the user cannot tell
// whether it is still recording.
//
// Everything else here is plumbing between `getUserMedia` and the worklet.

import { concatFrames, TARGET_SAMPLE_RATE } from './audio'
import { addCaptureWorklet, PROCESSOR_NAME, type VoiceFrameMessage } from './worklet'

/** Why capture stopped without the user asking it to. */
export type CaptureEnd = 'device-lost' | 'length-cap'

/**
 * What went wrong starting. Each maps to a sentence naming the recovery move —
 * `denied` in particular is the one users hit, and "permission denied" alone
 * tells them nothing about which of three settings screens to open.
 */
export type CaptureFailure = 'denied' | 'no-device' | 'unavailable'

export class CaptureError extends Error {
  constructor(readonly reason: CaptureFailure, message: string) {
    super(message)
    this.name = 'CaptureError'
  }
}

export interface CaptureHandlers {
  /** Peak level for the frame, 0–1, at 50 Hz. */
  onLevel: (level: number) => void
  /** One 20 ms frame at 16 kHz, for the streaming services. */
  onFrame: (frame: Float32Array) => void
  /** Capture ended by itself. The audio so far is still worth transcribing. */
  onEnd: (reason: CaptureEnd) => void
}

/** Five minutes. Bounds renderer memory and keeps every batch service under its
 *  own upload ceiling — OpenAI's 25 MB is the tightest, and five minutes of
 *  16 kHz mono WAV is under 10 MB. */
export const MAX_RECORDING_SECONDS = 300

function failureFor(err: unknown): CaptureFailure {
  const name = (err as { name?: string })?.name ?? ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-device'
  return 'unavailable'
}

function messageFor(reason: CaptureFailure): string {
  switch (reason) {
    case 'denied':
      return 'ouRGeo was not allowed to use the microphone. Allow it in your system privacy settings, then try again.'
    case 'no-device':
      return 'No microphone was found. Connect one, then pick it in Settings → Voice input.'
    case 'unavailable':
      return 'The microphone could not be opened — another application may be using it.'
  }
}

export class VoiceCapture {
  private stream: MediaStream | null = null
  private context: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  private frames: Float32Array[] = []
  private sampleCount = 0
  private handlers: CaptureHandlers | null = null
  private stopping = false

  get active(): boolean {
    return this.stream !== null
  }

  /** Seconds captured so far, for the timer and the cap warning. */
  get seconds(): number {
    return this.sampleCount / TARGET_SAMPLE_RATE
  }

  async start(deviceId: string | undefined, handlers: CaptureHandlers): Promise<void> {
    if (this.stream) return
    this.handlers = handlers
    this.frames = []
    this.sampleCount = 0
    this.stopping = false

    try {
      // `exact` rather than `ideal`: silently falling back to a different
      // microphone than the one the user chose is worse than failing, because
      // the level meter would move and the words would still be wrong.
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      })
    } catch (err) {
      const reason = failureFor(err)
      throw new CaptureError(reason, messageFor(reason))
    }

    try {
      // No `sampleRate` here: the worklet resamples unconditionally, so the
      // graph runs at whatever the device gives and there is no fallback
      // branch that only executes on the machines hardest to test on.
      this.context = new AudioContext()
      await addCaptureWorklet(this.context)
      if (this.stopping) { await this.release(); return }

      const source = this.context.createMediaStreamSource(this.stream)
      this.node = new AudioWorkletNode(this.context, PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        processorOptions: { targetRate: TARGET_SAMPLE_RATE },
      })
      this.node.port.onmessage = (e: MessageEvent<VoiceFrameMessage>) => this.onMessage(e.data)
      source.connect(this.node)

      // A microphone can be unplugged mid-sentence. `ended` is how that
      // arrives, and it is treated as a stop rather than an error: whatever
      // was said before it went is still worth transcribing.
      for (const track of this.stream.getTracks()) {
        track.addEventListener('ended', () => this.endedBy('device-lost'))
      }
    } catch {
      await this.release()
      throw new CaptureError('unavailable', messageFor('unavailable'))
    }
  }

  private onMessage(msg: VoiceFrameMessage): void {
    if (this.stopping || !this.handlers) return
    this.handlers.onLevel(msg.level)
    this.frames.push(msg.frame)
    this.sampleCount += msg.frame.length
    this.handlers.onFrame(msg.frame)
    if (this.seconds >= MAX_RECORDING_SECONDS) this.endedBy('length-cap')
  }

  private endedBy(reason: CaptureEnd): void {
    if (this.stopping) return
    this.stopping = true
    const handlers = this.handlers
    void this.release().then(() => handlers?.onEnd(reason))
  }

  /** Stop and hand back everything captured, at 16 kHz mono. */
  async stop(): Promise<Float32Array> {
    this.stopping = true
    await this.release()
    return concatFrames(this.frames)
  }

  /** Stop and throw the audio away — the user changed their mind. */
  async cancel(): Promise<void> {
    this.stopping = true
    await this.release()
    this.frames = []
    this.sampleCount = 0
  }

  private async release(): Promise<void> {
    if (this.node) {
      this.node.port.onmessage = null
      this.node.disconnect()
      this.node = null
    }
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    this.stream = null
    // `close()` can reject if the context is already closed — a released
    // microphone is the point, and there is nothing for the user to do here.
    await this.context?.close().catch(() => {})
    this.context = null
  }
}
