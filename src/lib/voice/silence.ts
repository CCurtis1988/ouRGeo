// When to stop listening on the user's behalf.
//
// Dictation ends in one of two ways: the user clicks the mic again, or they
// simply stop talking. The second is the one worth automating — reaching for
// the mouse to end a sentence you have just finished speaking is most of the
// friction a voice feature exists to remove.
//
// This is a reducer rather than something holding a timer, so `now` is an
// argument and the tests are ordinary assertions rather than fake clocks. The
// capture layer calls it with the level it already computed for the meter.

export type SilencePhase =
  /** Nothing has been said yet. Silence here means the user is still thinking. */
  | 'waiting'
  /** Sound above the threshold, right now. */
  | 'speaking'
  /** Quiet, but they were speaking a moment ago. */
  | 'trailing'
  /** Quiet for long enough after speech: stop and transcribe. */
  | 'stopped'

export interface SilenceState {
  phase: SilencePhase
  /** When the current quiet spell began, for `trailing`. */
  quietSince: number
}

export interface SilenceOptions {
  /** RMS above which a frame counts as speech. */
  threshold: number
  /** Quiet after speech before stopping. 0 disables auto-stop entirely. */
  trailingMs: number
}

export const INITIAL_SILENCE: SilenceState = { phase: 'waiting', quietSince: 0 }

/** A quiet room reads around 0.005 RMS; speech at arm's length is well above this. */
export const DEFAULT_SILENCE_OPTIONS: SilenceOptions = { threshold: 0.02, trailingMs: 1500 }

/**
 * Advance the machine by one frame.
 *
 * Two rules carry the design:
 *
 * - **Silence before any speech never stops the recording.** Someone who arms
 *   the mic and then thinks for three seconds has not finished dictating, and
 *   a recorder that gives up on them is worse than no auto-stop at all.
 * - **A pause is not an ending.** Speech resuming during the trailing window
 *   returns to `speaking` and the window starts again from the next quiet
 *   frame, so a mid-sentence breath cannot truncate the recording.
 */
export function silenceStep(
  state: SilenceState,
  level: number,
  now: number,
  opts: SilenceOptions = DEFAULT_SILENCE_OPTIONS,
): SilenceState {
  if (state.phase === 'stopped') return state

  const speaking = level > opts.threshold
  if (speaking) return { phase: 'speaking', quietSince: 0 }

  // Quiet. Only meaningful once something has been said.
  if (state.phase === 'waiting') return state
  if (opts.trailingMs <= 0) return { phase: 'trailing', quietSince: state.quietSince || now }

  if (state.phase === 'speaking') return { phase: 'trailing', quietSince: now }
  return now - state.quietSince >= opts.trailingMs
    ? { phase: 'stopped', quietSince: state.quietSince }
    : state
}

/** Whether anything worth transcribing was heard at all. */
export function heardSpeech(state: SilenceState): boolean {
  return state.phase !== 'waiting'
}
