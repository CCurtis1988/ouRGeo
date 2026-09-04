import { describe, it, expect } from 'vitest'
import {
  BUILTIN_SERVICES, DEFAULT_SERVICE_ID, resolveService, serviceById, serviceList, servicesByKind,
} from './registry'

describe('the shipped services', () => {
  it('have unique ids', () => {
    const ids = serviceList().map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('default to the one that needs no account', () => {
    // The first dictation should not begin with a form. Only the on-device
    // engine can promise that.
    expect(resolveService(DEFAULT_SERVICE_ID).kind).toBe('on-device')
  })

  it('each declare the key ids they read, or none at all', () => {
    for (const s of serviceList()) {
      if (s.apiKeyId) expect(s.apiKeyId).toMatch(/^voice_/)
      if (s.urlKeyId) {
        expect(s.urlKeyId).toMatch(/^voice_/)
        // A base URL the user can clear needs something to fall back to.
        expect(s.defaultUrl, `${s.id} has a URL field but no default`).toBeTruthy()
      }
    }
  })

  it('name the missing field rather than just refusing', () => {
    for (const s of serviceList()) {
      const message = s.configError({})
      if (message) expect(message, s.id).toMatch(/Settings/)
    }
  })
})

describe('resolving a stored choice', () => {
  it('falls back to the default when the service is gone', () => {
    // A preferences file naming a service that no longer exists must not leave
    // the panel unable to transcribe anything.
    expect(resolveService('a-service-that-was-removed').id).toBe(DEFAULT_SERVICE_ID)
  })

  it('finds a service that does exist', () => {
    expect(serviceById('openai-compatible')?.label).toBe('OpenAI-compatible endpoint')
    expect(serviceById('nope')).toBeUndefined()
  })
})

describe('grouping for the picker', () => {
  it('puts what runs here before what runs elsewhere', () => {
    const kinds = servicesByKind().map((g) => g.kind)
    expect(kinds[0]).toBe('on-device')
  })

  it('lists every shipped service exactly once', () => {
    const grouped = servicesByKind().flatMap((g) => g.services.map((s) => s.id))
    expect(grouped.sort()).toEqual(BUILTIN_SERVICES.map((s) => s.id).sort())
  })

  it('shows no empty groups', () => {
    for (const g of servicesByKind()) expect(g.services.length).toBeGreaterThan(0)
  })
})
