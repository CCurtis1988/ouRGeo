import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  deepgramParams, deepgramService, parseDeepgramRest, readDeepgramMessage, setSocketFactory,
} from './deepgram'
import { TranscriptionError } from '../types'

/** A WebSocket that never touches a network, so the whole streaming state
 *  machine can be driven from a test: open it, feed it messages, close it. */
class FakeSocket {
  static last: FakeSocket
  sent: unknown[] = []
  binaryType = ''
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((e: { code: number; reason: string }) => void) | null = null
  constructor(readonly url: string, readonly protocols: string[]) { FakeSocket.last = this }
  send(data: unknown): void { this.sent.push(data) }
  close(): void { this.onclose?.({ code: 1000, reason: '' }) }

  open(): void { this.onopen?.() }
  results(transcript: string, isFinal: boolean): void {
    this.onmessage?.({ data: JSON.stringify({
      type: 'Results', is_final: isFinal, channel: { alternatives: [{ transcript }] },
    }) })
  }
  raw(data: string): void { this.onmessage?.({ data }) }
}

beforeEach(() => {
  setSocketFactory((url, protocols) =>
    new FakeSocket(url, protocols) as unknown as WebSocket)
})

describe('what Deepgram is told about the audio', () => {
  it('describes the frames it is about to receive', () => {
    // The socket carries raw PCM with no container, so every one of these is
    // load-bearing: get the rate wrong and it transcribes a chipmunk.
    const params = new URLSearchParams(deepgramParams('nova-3', '', true))
    expect(params.get('encoding')).toBe('linear16')
    expect(params.get('sample_rate')).toBe('16000')
    expect(params.get('channels')).toBe('1')
    expect(params.get('model')).toBe('nova-3')
  })

  it('asks for interim results only when streaming', () => {
    expect(deepgramParams('nova-3', '', true)).toContain('interim_results=true')
    expect(deepgramParams('nova-3', '', false)).not.toContain('interim_results')
  })

  it('sends a language only when one was chosen', () => {
    expect(deepgramParams('nova-3', 'fr', true)).toContain('language=fr')
    expect(deepgramParams('nova-3', '', true)).not.toContain('language=')
  })
})

describe('reading the socket', () => {
  it('takes the transcript out of a results message', () => {
    expect(readDeepgramMessage(JSON.stringify({
      type: 'Results', is_final: true, channel: { alternatives: [{ transcript: 'hello' }] },
    }))).toEqual({ transcript: 'hello', isFinal: true })
  })

  it('ignores metadata and keep-alives rather than reading them as silence', () => {
    // An empty transcript is a real answer that would wipe the interim text
    // the user is watching, so "not a result" must not become "no words".
    expect(readDeepgramMessage(JSON.stringify({ type: 'Metadata' }))).toBeNull()
    expect(readDeepgramMessage('not json at all')).toBeNull()
  })
})

describe('a live dictation', () => {
  it('queues frames until the socket opens, then sends them', async () => {
    const session = await deepgramService.openStream!({
      keys: { voice_deepgram_key: 'k' }, model: 'nova-3', language: '', onPartial: () => {},
    })
    const socket = FakeSocket.last
    session.push(new Int16Array([1, 2, 3]))
    session.push(new Int16Array([4, 5, 6]))
    expect(socket.sent).toHaveLength(0)   // nothing sent down a socket that is not open
    socket.open()
    expect(socket.sent).toHaveLength(2)
  })

  it('carries the key as a subprotocol, because a browser socket has no headers', () => {
    void deepgramService.openStream!({
      keys: { voice_deepgram_key: 'secret' }, model: 'nova-3', language: '', onPartial: () => {},
    })
    expect(FakeSocket.last.protocols).toEqual(['token', 'secret'])
  })

  it('shows interim words, then keeps only what was finalised', async () => {
    const seen: string[] = []
    const session = await deepgramService.openStream!({
      keys: { voice_deepgram_key: 'k' }, model: 'nova-3', language: '',
      onPartial: (t) => seen.push(t),
    })
    const socket = FakeSocket.last
    socket.open()
    socket.results('buffer the', false)
    socket.results('buffer the roads', true)
    socket.results('layer', false)
    expect(seen).toEqual(['buffer the', 'buffer the roads', 'buffer the roads layer'])

    const done = session.finish()
    socket.close()
    // The unfinalised "layer" is dropped: only what Deepgram committed to is
    // put in the user's message box.
    expect(await done).toBe('buffer the roads')
  })

  it('asks the server to flush before it stops waiting', async () => {
    const session = await deepgramService.openStream!({
      keys: { voice_deepgram_key: 'k' }, model: 'nova-3', language: '', onPartial: () => {},
    })
    const socket = FakeSocket.last
    socket.open()
    const done = session.finish()
    expect(socket.sent).toContain(JSON.stringify({ type: 'CloseStream' }))
    socket.close()
    await done
  })

  it('gives up rather than hanging when the socket never answers', async () => {
    vi.useFakeTimers()
    try {
      const session = await deepgramService.openStream!({
        keys: { voice_deepgram_key: 'k' }, model: 'nova-3', language: '', onPartial: () => {},
      })
      FakeSocket.last.open()
      FakeSocket.last.results('half a sentence', true)
      const done = session.finish()
      // Without the timeout the panel would sit in "transcribing" for ever.
      await vi.advanceTimersByTimeAsync(5000)
      expect(await done).toBe('half a sentence')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the batch fallback', () => {
  it('reads the transcript out of the REST shape', () => {
    expect(parseDeepgramRest(JSON.stringify({
      results: { channels: [{ alternatives: [{ transcript: ' hello ' }] }] },
    }))).toBe('hello')
  })

  it('raises Deepgram’s own message when it refuses', () => {
    expect(() => parseDeepgramRest('{"err_msg":"insufficient credits"}'))
      .toThrow(TranscriptionError)
  })
})

describe('what it refuses to start without', () => {
  it('names the key and where to put it', () => {
    expect(deepgramService.configError({})).toContain('Settings → Voice input')
    expect(deepgramService.configError({ voice_deepgram_key: 'k' })).toBeNull()
  })
})
