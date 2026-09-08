import { describe, it, expect } from 'vitest'
import { describeFetchFailure, hostOf, isLoopbackHost } from './ai-fetch-error'

/** What Node's undici actually throws, nested exactly as it nests it. */
const undici = (code: string, message: string): Error =>
  Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error(message), { code }),
  })

/** What Chromium's stack throws: a bare `net::ERR_…` and no cause at all. */
const chromium = (message: string): Error => new Error(message)

const LOCAL = 'http://127.0.0.1:8080/v1/chat/completions'
const CLOUD = 'https://api.anthropic.com/v1/messages'

describe('naming the host', () => {
  it('keeps the port, because that is what tells two local servers apart', () => {
    expect(hostOf(LOCAL)).toBe('127.0.0.1:8080')
    expect(hostOf(CLOUD)).toBe('api.anthropic.com')
  })

  it('recognises this machine, however it was written', () => {
    expect(isLoopbackHost(LOCAL)).toBe(true)
    expect(isLoopbackHost('http://localhost:1234/v1')).toBe(true)
    expect(isLoopbackHost('http://192.168.1.40:8000/v1')).toBe(true)
    expect(isLoopbackHost(CLOUD)).toBe(false)
  })
})

describe('what "fetch failed" was hiding', () => {
  it('a server that is not running says so, and says how to fix it', () => {
    const msg = describeFetchFailure(LOCAL, undici('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:8080'), true)
    expect(msg).toContain('127.0.0.1:8080')
    expect(msg).toContain('Start the server')
    expect(msg).not.toContain('fetch failed')
  })

  it('reads Chromium’s vocabulary as well as undici’s', () => {
    // The proxy uses net.fetch, which reports the same conditions in an
    // entirely different spelling and with no `cause` to unwrap.
    expect(describeFetchFailure(LOCAL, chromium('net::ERR_CONNECTION_REFUSED'), true))
      .toContain('Start the server')
    expect(describeFetchFailure(CLOUD, chromium('net::ERR_NAME_NOT_RESOLVED')))
      .toContain('could not be resolved')
  })

  it('tells a five-minute silence apart from a refusal', () => {
    // This is the one the user saw: a local model given a large prompt sent
    // nothing for five minutes and ouRGeo’s own client gave up on it.
    const msg = describeFetchFailure(LOCAL, undici('UND_ERR_HEADERS_TIMEOUT', 'Headers Timeout Error'), true)
    expect(msg).toContain('sent nothing back')
    expect(msg).toContain('long prompt')
  })

  it('says a dropped connection is a dropped connection', () => {
    expect(describeFetchFailure(LOCAL, undici('ECONNRESET', 'socket hang up'), true))
      .toContain('dropped before the reply finished')
    // Observed in the app: a server that streams four words and then closes
    // the socket. Chromium calls it an incomplete chunked encoding; the user
    // needs to be told the answer above is not the whole answer.
    expect(describeFetchFailure(LOCAL, chromium('net::ERR_INCOMPLETE_CHUNKED_ENCODING'), true))
      .toContain('dropped before the reply finished')
  })

  it('blames the certificate when it is the certificate', () => {
    expect(describeFetchFailure('https://box.lan:8443/v1', undici('DEPTH_ZERO_SELF_SIGNED_CERT', 'self-signed certificate')))
      .toContain('certificate')
  })

  it('still names the host for something it has never seen', () => {
    const msg = describeFetchFailure(CLOUD, new Error('something entirely new'))
    expect(msg).toContain('api.anthropic.com')
    expect(msg).toContain('something entirely new')
  })

  it('survives a cause chain that loops or runs deep', () => {
    const a: { message: string; cause?: unknown } = { message: 'a' }
    a.cause = a
    expect(() => describeFetchFailure(LOCAL, a)).not.toThrow()
  })
})
