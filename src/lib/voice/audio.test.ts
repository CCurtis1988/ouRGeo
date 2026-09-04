import { describe, it, expect } from 'vitest'
import {
  concatFrames, durationSeconds, encodeWav, floatToPcm16, resample, rms, TARGET_SAMPLE_RATE,
} from './audio'

const ascii = (bytes: Uint8Array, at: number, len: number): string =>
  String.fromCharCode(...bytes.slice(at, at + len))

const u32 = (bytes: Uint8Array, at: number): number =>
  new DataView(bytes.buffer).getUint32(at, true)

const u16 = (bytes: Uint8Array, at: number): number =>
  new DataView(bytes.buffer).getUint16(at, true)

describe('16-bit conversion', () => {
  it('uses the whole range in both directions without wrapping', () => {
    // Scaling positives by 32768 wraps full scale round to the most negative
    // sample — a click at exactly the moment someone raises their voice.
    const out = floatToPcm16(new Float32Array([-1, 0, 1]))
    expect(Array.from(out)).toEqual([-32768, 0, 32767])
  })

  it('clamps anything the microphone pushed past full scale', () => {
    const out = floatToPcm16(new Float32Array([-4, 2.5]))
    expect(Array.from(out)).toEqual([-32768, 32767])
  })

  it('rounds rather than truncating towards zero', () => {
    const out = floatToPcm16(new Float32Array([0.00003]))
    expect(out[0]).toBe(1)
  })
})

describe('the level the meter draws', () => {
  it('is zero for silence and one for full scale', () => {
    expect(rms(new Float32Array([0, 0, 0]))).toBe(0)
    expect(rms(new Float32Array([1, -1, 1, -1]))).toBe(1)
  })

  it('is zero for an empty frame rather than NaN', () => {
    // A NaN here reaches a CSS transform and the ring silently stops moving,
    // which reads to the user as a microphone that is not picking anything up.
    expect(rms(new Float32Array(0))).toBe(0)
  })
})

describe('resampling to what the recogniser expects', () => {
  it('shortens the buffer by the rate ratio', () => {
    const input = new Float32Array(48000)
    expect(resample(input, 48000, TARGET_SAMPLE_RATE)).toHaveLength(16000)
  })

  it('returns the input untouched when the rate already matches', () => {
    const input = new Float32Array([0.1, 0.2])
    expect(resample(input, 16000, 16000)).toBe(input)
  })

  it('interpolates between samples rather than dropping them', () => {
    // Halving the rate of a ramp should land on the values in between, not on
    // every other original sample.
    const out = resample(new Float32Array([0, 1, 2, 3]), 4, 2)
    expect(Array.from(out)).toEqual([0, 2])
  })

  it('never reads past the end of the input', () => {
    expect(() => resample(new Float32Array([1, 2, 3]), 3, 2)).not.toThrow()
  })
})

describe('the WAV a batch service receives', () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1])
  const wav = encodeWav(samples, TARGET_SAMPLE_RATE)

  it('is a RIFF/WAVE file with a PCM fmt chunk', () => {
    expect(ascii(wav, 0, 4)).toBe('RIFF')
    expect(ascii(wav, 8, 4)).toBe('WAVE')
    expect(ascii(wav, 12, 4)).toBe('fmt ')
    expect(ascii(wav, 36, 4)).toBe('data')
    expect(u16(wav, 20)).toBe(1)     // uncompressed PCM
  })

  it('is 44 bytes of header plus two bytes a sample', () => {
    expect(wav.length).toBe(44 + samples.length * 2)
    expect(u32(wav, 40)).toBe(samples.length * 2)
    // The RIFF size counts everything after its own field.
    expect(u32(wav, 4)).toBe(36 + samples.length * 2)
  })

  it('writes the rate little-endian, where a RIFF reader looks for it', () => {
    // Big-endian here produces a file that opens, plays as noise and
    // transcribes as nothing.
    expect(u32(wav, 24)).toBe(TARGET_SAMPLE_RATE)
    expect(u32(wav, 28)).toBe(TARGET_SAMPLE_RATE * 2)  // byte rate
    expect(u16(wav, 32)).toBe(2)                        // block align
    expect(u16(wav, 34)).toBe(16)                       // bits per sample
    expect(u16(wav, 22)).toBe(1)                        // mono
  })

  it('carries the samples themselves, converted', () => {
    const view = new DataView(wav.buffer)
    expect(view.getInt16(44, true)).toBe(0)
    expect(view.getInt16(46, true)).toBe(Math.round(0.5 * 0x7fff))
    expect(view.getInt16(50, true)).toBe(32767)
  })

  it('is a valid, empty file when nothing was recorded', () => {
    const empty = encodeWav(new Float32Array(0))
    expect(empty.length).toBe(44)
    expect(u32(empty, 40)).toBe(0)
  })
})

describe('accumulating a recording', () => {
  it('joins frames in order', () => {
    const joined = concatFrames([new Float32Array([1, 2]), new Float32Array([3])])
    expect(Array.from(joined)).toEqual([1, 2, 3])
  })

  it('reports its length in seconds, for the timer and the cap', () => {
    expect(durationSeconds(new Float32Array(TARGET_SAMPLE_RATE * 3))).toBe(3)
    expect(durationSeconds(new Float32Array(10), 0)).toBe(0)
  })
})
