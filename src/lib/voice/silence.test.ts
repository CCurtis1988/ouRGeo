import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SILENCE_OPTIONS, heardSpeech, INITIAL_SILENCE, silenceStep, type SilenceState,
} from './silence'

const LOUD = 0.4
const QUIET = 0.001

/** Feed a run of frames 100 ms apart and return where the machine ended up. */
function run(levels: number[], opts = DEFAULT_SILENCE_OPTIONS, step = 100): SilenceState {
  let state = INITIAL_SILENCE
  levels.forEach((level, i) => { state = silenceStep(state, level, i * step, opts) })
  return state
}

describe('stopping when the speaker stops', () => {
  it('stops once the room has been quiet for the trailing window', () => {
    // 100 ms of speech, then 1.6 s of quiet against a 1.5 s window.
    const state = run([LOUD, ...Array(16).fill(QUIET)])
    expect(state.phase).toBe('stopped')
  })

  it('is still listening while the quiet is shorter than the window', () => {
    const state = run([LOUD, QUIET, QUIET, QUIET])
    expect(state.phase).toBe('trailing')
  })
})

describe('the two rules that make it usable', () => {
  it('never stops on silence before anything was said', () => {
    // Arming the mic and thinking for five seconds is not the end of a
    // dictation, and a recorder that gives up there is worse than none.
    const state = run(Array(50).fill(QUIET))
    expect(state.phase).toBe('waiting')
    expect(heardSpeech(state)).toBe(false)
  })

  it('treats a pause mid-sentence as a pause, not an ending', () => {
    // Quiet, then a breath of speech, then quiet again: the window restarts,
    // so the recording survives the pause.
    const state = run([LOUD, QUIET, QUIET, LOUD, QUIET, QUIET])
    expect(state.phase).toBe('trailing')
  })

  it('restarts the window from the pause, not from the first one', () => {
    // 1.4 s quiet, one word, then 1.4 s quiet again — under the window both
    // times, so it must still be listening rather than having summed them.
    const state = run([LOUD, ...Array(14).fill(QUIET), LOUD, ...Array(14).fill(QUIET)])
    expect(state.phase).toBe('trailing')
  })
})

describe('turning auto-stop off', () => {
  it('never reaches stopped when the window is zero', () => {
    const state = run([LOUD, ...Array(100).fill(QUIET)], { threshold: 0.02, trailingMs: 0 })
    expect(state.phase).toBe('trailing')
  })
})

describe('once stopped', () => {
  it('stays stopped, however loud it gets afterwards', () => {
    // The capture layer tears down on `stopped`; a machine that flipped back
    // to `speaking` would race it.
    let state = run([LOUD, ...Array(16).fill(QUIET)])
    state = silenceStep(state, LOUD, 9999)
    expect(state.phase).toBe('stopped')
  })

  it('reports that speech was heard, so an empty transcript is distinguishable', () => {
    expect(heardSpeech(run([LOUD, ...Array(16).fill(QUIET)]))).toBe(true)
  })
})
