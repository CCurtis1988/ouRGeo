import { describe, it, expect } from 'vitest'
import {
  buildElevenLabsRequest, ELEVENLABS_API_KEY, elevenLabsService, parseElevenLabsResponse,
} from './elevenlabs'
import {
  ASSEMBLYAI_API_KEY, assemblyAiService, assemblyHeaders, nextPoll, parseUploadUrl, readJob,
} from './assemblyai'
import { TranscriptionError } from '../types'

describe('ElevenLabs Scribe', () => {
  it('sends the key in its own header, not as a bearer token', () => {
    // Each of these services spells the same three things differently, and
    // each spelling mistake produces a 400 with nothing useful in it.
    const req = buildElevenLabsRequest({ [ELEVENLABS_API_KEY]: 'xi-1' }, 'scribe_v1', '')
    expect(req.headers).toEqual({ 'xi-api-key': 'xi-1' })
    expect(Object.keys(req.headers).map((h) => h.toLowerCase())).not.toContain('content-type')
  })

  it('calls the model field model_id', () => {
    expect(buildElevenLabsRequest({}, 'scribe_v1', '').fields).toEqual({ model_id: 'scribe_v1' })
  })

  it('calls the language field language_code, and omits it when unset', () => {
    expect(buildElevenLabsRequest({}, 'scribe_v1', 'de').fields.language_code).toBe('de')
    expect(buildElevenLabsRequest({}, 'scribe_v1', '').fields.language_code).toBeUndefined()
  })

  it('reads the transcript, and raises their message when refused', () => {
    expect(parseElevenLabsResponse('{"text":" hello "}')).toBe('hello')
    expect(() => parseElevenLabsResponse('{"detail":{"message":"quota exceeded"}}'))
      .toThrow(TranscriptionError)
  })

  it('names the key and where to put it', () => {
    expect(elevenLabsService.configError({})).toContain('Settings → Voice input')
  })
})

describe('AssemblyAI', () => {
  it('sends the key bare, with no scheme in front of it', () => {
    // `Bearer <key>` is rejected here, which is the sort of thing that costs an
    // afternoon if it is not written down.
    expect(assemblyHeaders({ [ASSEMBLYAI_API_KEY]: 'aa-1' })).toEqual({ Authorization: 'aa-1' })
  })

  it('takes the upload location out of the first response', () => {
    expect(parseUploadUrl('{"upload_url":"https://cdn/x"}')).toBe('https://cdn/x')
    expect(() => parseUploadUrl('{}')).toThrow(TranscriptionError)
  })

  it('reads a job through its whole life', () => {
    expect(readJob('{"status":"queued"}').status).toBe('queued')
    expect(readJob('{"status":"processing"}').status).toBe('processing')
    expect(readJob('{"status":"completed","text":" done "}'))
      .toEqual({ status: 'completed', text: 'done', error: null })
    expect(readJob('{"status":"error","error":"audio too short"}').error).toBe('audio too short')
  })

  it('treats an unreadable reply as unknown rather than as finished', () => {
    // "Finished with no text" and "we could not read the answer" are different
    // things, and only one of them should silently clear the composer.
    expect(readJob('<html>502</html>').status).toBe('unknown')
  })

  it('backs off as the wait grows, and stops asking eventually', () => {
    expect(nextPoll(0)).toBe(500)
    expect(nextPoll(10_000)).toBe(1_500)
    expect(nextPoll(60_000)).toBe(3_000)
    // A dictation stuck in "transcribing" with no end is worse than one that
    // admits it gave up.
    expect(nextPoll(200_000)).toBeNull()
  })

  it('names the key and where to put it', () => {
    expect(assemblyAiService.configError({})).toContain('Settings → Voice input')
    expect(assemblyAiService.configError({ [ASSEMBLYAI_API_KEY]: 'k' })).toBeNull()
  })
})
