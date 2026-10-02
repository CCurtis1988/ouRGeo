import { describe, expect, it } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { validateChatGptIdentity } from './chatgpt-identity'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const key = { ...publicKey.export({ format: 'jwk' }), kid: 'test', alg: 'RS256' }
const claims = { iss: 'https://auth.openai.com', aud: 'oaiapp_test', sub: 'user', email: 'test@example.com', exp: Date.now() / 1000 + 3600, nonce: 'nonce' }
function token(overrides = {}, alg = 'RS256') {
  const payload = [Buffer.from(JSON.stringify({ alg, kid: 'test' })).toString('base64url'), Buffer.from(JSON.stringify({ ...claims, ...overrides })).toString('base64url')].join('.')
  return `${payload}.${sign('sha256', Buffer.from(payload), privateKey).toString('base64url')}`
}

describe('ChatGPT account identity', () => {
  it('accepts the signed identity bound to this client and sign-in attempt', () => {
    expect(validateChatGptIdentity(token(), [key], 'oaiapp_test', 'nonce')).toEqual({ subject: 'user', email: 'test@example.com' })
  })
  it.each([
    { iss: 'https://attacker.example' }, { aud: 'other-client' }, { exp: 1 }, { nonce: 'other-attempt' }, { sub: '' },
    { aud: ['oaiapp_test', 'other-client'], azp: 'other-client' }, { nbf: Date.now() / 1000 + 3600 },
  ])('rejects a signed token whose claims are not bound to this account (%j)', (overrides) => {
    expect(() => validateChatGptIdentity(token(overrides), [key], 'oaiapp_test', 'nonce')).toThrow()
  })
  it('rejects tampering and unsigned or substituted signing algorithms', () => {
    const signed = token().split('.')
    signed[1] = Buffer.from(JSON.stringify({ ...claims, sub: 'attacker' })).toString('base64url')
    expect(() => validateChatGptIdentity(signed.join('.'), [key], 'oaiapp_test', 'nonce')).toThrow()
    expect(() => validateChatGptIdentity(token({}, 'none'), [key], 'oaiapp_test', 'nonce')).toThrow()
  })
})
