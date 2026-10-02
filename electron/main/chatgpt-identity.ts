import { createPublicKey, verify, type JsonWebKey } from 'node:crypto'

/** Only a verified ID token may choose which registration receives credentials.
 * Decoding a JWT alone would let a callback replace a different user's account. */
export function validateChatGptIdentity(
  token: string, keys: (JsonWebKey & { kid?: string; alg?: string; use?: string })[],
  clientId: string, nonce: string, now = Date.now(),
): { subject: string; email: string | null } {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('OpenAI returned an invalid ID token. Sign in again.')
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString())
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
  const key = keys.find((k) => k.kid === header.kid && (!k.use || k.use === 'sig'))
  if (!key || !['RS256', 'ES256'].includes(header.alg) || (key.alg && key.alg !== header.alg)
    || (header.alg === 'RS256' ? key.kty !== 'RSA' : key.kty !== 'EC' || key.crv !== 'P-256')) {
    throw new Error('Could not verify OpenAI’s signing key. Sign in again.')
  }
  const publicKey = createPublicKey({ key, format: 'jwk' })
  const verified = verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`),
    { key: publicKey, ...(header.alg === 'ES256' ? { dsaEncoding: 'ieee-p1363' as const } : {}) },
    Buffer.from(parts[2], 'base64url'))
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!verified || claims.iss !== 'https://auth.openai.com' || !audience.includes(clientId)
    || (audience.length > 1 && claims.azp !== clientId)
    || typeof claims.exp !== 'number' || claims.exp * 1000 <= now
    || (typeof claims.nbf === 'number' && claims.nbf * 1000 > now)
    || claims.nonce !== nonce || typeof claims.sub !== 'string' || !claims.sub) {
    throw new Error('OpenAI’s account identity could not be validated. Sign in again.')
  }
  return { subject: claims.sub, email: typeof claims.email === 'string' ? claims.email : null }
}
