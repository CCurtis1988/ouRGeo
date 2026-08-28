import { describe, it, expect, vi } from 'vitest'
import {
  isTransientNetworkError, isTransportFailure, retryOnNetworkError,
  transportFailureMessage, transportFailureForModel, TransportError,
} from './transport-retry'

// A local model was told only "Network Error" when adding a layer, and spent
// twenty turns simplifying geometry, reprojecting, and rebuilding the object
// looking for a fault that was never in the data. These pin the two halves of
// the fix: retry the severed request, and say what actually happened.

const severed = Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' })
const httpError = Object.assign(new Error('Request failed with status code 500'), {
  response: { status: 500, data: { error: 'object not found' } },
})

describe('isTransientNetworkError', () => {
  it('recognises a request that died without a response', () => {
    expect(isTransientNetworkError(severed)).toBe(true)
    expect(isTransientNetworkError(new Error('Network Error'))).toBe(true)
  })

  it('leaves R\'s own answers alone — an HTTP error must never be retried', () => {
    expect(isTransientNetworkError(httpError)).toBe(false)
    expect(isTransientNetworkError(new Error('no geometry returned'))).toBe(false)
    expect(isTransientNetworkError(undefined)).toBe(false)
  })
})

describe('isTransportFailure', () => {
  it('also recognises one already translated into a sentence', () => {
    // The raw "Network Error" text is gone by then, so the class is the tell.
    const translated = new TransportError(transportFailureMessage('reading "buf"'))
    expect(isTransientNetworkError(translated)).toBe(false)
    expect(isTransportFailure(translated)).toBe(true)
    expect(isTransportFailure(httpError)).toBe(false)
  })
})

describe('retryOnNetworkError', () => {
  it('retries a severed request and returns the retry\'s result', async () => {
    let n = 0
    const fn = vi.fn(async () => {
      n += 1
      if (n === 1) throw severed
      return 'ok'
    })
    await expect(retryOnNetworkError(fn, { delayMs: 0 })).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('gives up after the last try, rethrowing the original', async () => {
    const fn = vi.fn(async () => { throw severed })
    await expect(retryOnNetworkError(fn, { tries: 3, delayMs: 0 })).rejects.toBe(severed)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('does not retry an HTTP error', async () => {
    const fn = vi.fn(async () => { throw httpError })
    await expect(retryOnNetworkError(fn, { delayMs: 0 })).rejects.toBe(httpError)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('what each audience is told', () => {
  it('tells a person the data is fine and R is still up', () => {
    const out = transportFailureMessage('reading the geometry of "buf"')
    expect(out).toContain('reading the geometry of "buf"')
    expect(out).toMatch(/not a problem with the data/)
    expect(out).toMatch(/R itself is still running/)
    expect(out).not.toMatch(/Network Error/)
  })

  it('tells the model to retry once and then stop, not to rebuild the object', () => {
    const out = transportFailureForModel('adding "buf" to the map', '"buf"')
    expect(out).toMatch(/transport failure/)
    expect(out).toMatch(/"buf" is valid and unchanged/)
    expect(out).toMatch(/Retry the SAME call once/)
    expect(out).toMatch(/Do not simplify geometry, rebuild the object/)
  })
})
