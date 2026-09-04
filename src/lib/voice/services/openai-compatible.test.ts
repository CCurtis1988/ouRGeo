import { describe, it, expect } from 'vitest'
import {
  buildOpenAiRequest, joinUrl, OPENAI_DEFAULT_URL, OPENAI_VOICE_API_KEY, OPENAI_VOICE_URL_KEY,
  openAiCompatibleService, parseOpenAiResponse,
} from './openai-compatible'
import { TranscriptionError } from '../types'

describe('where the request goes', () => {
  it('defaults to OpenAI when no base URL is set', () => {
    expect(buildOpenAiRequest({}, 'whisper-1', '').url)
      .toBe('https://api.openai.com/v1/audio/transcriptions')
  })

  it('joins a base URL without doubling or dropping the slash', () => {
    // A user pasting a URL from a README brings the trailing slash with them
    // about half the time, and `//audio` 404s on several local servers.
    expect(joinUrl('http://localhost:8080/v1/', '/audio/transcriptions'))
      .toBe('http://localhost:8080/v1/audio/transcriptions')
    expect(joinUrl('http://localhost:8080/v1', 'audio/transcriptions'))
      .toBe('http://localhost:8080/v1/audio/transcriptions')
  })

  it('points at a local server when one is configured', () => {
    const req = buildOpenAiRequest(
      { [OPENAI_VOICE_URL_KEY]: 'http://127.0.0.1:8080/v1' }, 'whisper-1', '')
    expect(req.url).toBe('http://127.0.0.1:8080/v1/audio/transcriptions')
  })
})

describe('what the request carries', () => {
  it('never sets Content-Type', () => {
    // `fetch` computes the multipart boundary. Setting the header by hand
    // produces a boundary-less content type and a 400 that explains nothing.
    const req = buildOpenAiRequest({ [OPENAI_VOICE_API_KEY]: 'sk-x' }, 'whisper-1', 'en')
    expect(Object.keys(req.headers).map((h) => h.toLowerCase())).not.toContain('content-type')
  })

  it('sends a bearer token when there is one', () => {
    expect(buildOpenAiRequest({ [OPENAI_VOICE_API_KEY]: 'sk-x' }, 'whisper-1', '').headers)
      .toEqual({ Authorization: 'Bearer sk-x' })
  })

  it('omits the header entirely when there is no key', () => {
    // A local server usually wants no key, and some reject a malformed
    // Authorization header they would have accepted the absence of.
    expect(buildOpenAiRequest({}, 'whisper-1', '').headers).toEqual({})
  })

  it('sends the model, and the language only when one was chosen', () => {
    expect(buildOpenAiRequest({}, 'whisper-1', '').fields).toEqual({ model: 'whisper-1' })
    expect(buildOpenAiRequest({}, 'whisper-1', 'fr').fields)
      .toEqual({ model: 'whisper-1', language: 'fr' })
  })
})

describe('reading the answer', () => {
  it('takes the text out of a normal response', () => {
    expect(parseOpenAiResponse('{"text":"  buffer the roads layer  "}'))
      .toBe('buffer the roads layer')
  })

  it('accepts plain text, which whisper.cpp can be configured to return', () => {
    expect(parseOpenAiResponse('buffer the roads layer\n')).toBe('buffer the roads layer')
  })

  it('raises the service’s own error message rather than a status code', () => {
    expect(() => parseOpenAiResponse('{"error":{"message":"model not found"}}'))
      .toThrow(TranscriptionError)
  })

  it('is empty, not undefined, when nothing was recognised', () => {
    expect(parseOpenAiResponse('{}')).toBe('')
  })
})

describe('what it refuses to start without', () => {
  it('asks for a key when pointed at a hosted endpoint', () => {
    const msg = openAiCompatibleService.configError({})
    expect(msg).toContain(OPENAI_DEFAULT_URL)
    // The rule for every message in this feature: name the way out.
    expect(msg).toContain('Settings → Voice input')
  })

  it('lets a local server run with no key at all', () => {
    expect(openAiCompatibleService.configError({
      [OPENAI_VOICE_URL_KEY]: 'http://localhost:8080/v1',
    })).toBeNull()
  })

  it('is satisfied once the key is there', () => {
    expect(openAiCompatibleService.configError({ [OPENAI_VOICE_API_KEY]: 'sk-x' })).toBeNull()
  })
})
