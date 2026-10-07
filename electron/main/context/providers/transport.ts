import type { ProviderHost } from '../../../../src/lib/context/providers/types'

export interface ConnectionProfile {
  endpoint: string
  local: boolean
  token?: string
}
export type JsonTransport = (path: string, method: 'GET' | 'POST' | 'DELETE', body: unknown, host: ProviderHost, headers?: Record<string, string>, onHeaders?: (headers: Headers) => void) => Promise<unknown>

/** Endpoints come only from deliberate connection setup. Redirects cannot
 * move credentials or project evidence to another processing destination. */
export function connectionUrl(profile: ConnectionProfile): URL {
  const url = new URL(profile.endpoint)
  if (url.username || url.password || url.search || url.hash) throw new Error('Use an endpoint without credentials, query parameters or a fragment.')
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && profile.local && loopback)) throw new Error('Use HTTPS, or explicitly choose a loopback local-service profile.')
  if (profile.token && /[\r\n]/.test(profile.token)) throw new Error('Enter a single-line authentication token.')
  return url
}

export function createJsonTransport(profile: ConnectionProfile, fetcher: typeof fetch = fetch): JsonTransport {
  const base = connectionUrl(profile)
  return async (path, method, body, host, headers = {}, onHeaders) => {
    host.signal.throwIfAborted()
    if (!host.authorised()) throw new Error('POLICY_REFUSED')
    if (!Number.isFinite(host.maxTokens) || host.maxTokens < 0 || !Number.isFinite(host.timeoutMs)) throw new Error('BUDGET_LIMIT')
    if (Object.keys(headers).some(name => !['mcp-protocol-version', 'mcp-session-id'].includes(name.toLowerCase()))) throw new Error('POLICY_REFUSED')
    if (path && (!path.startsWith('/') || path.includes('..') || path.includes('?') || path.includes('#'))) throw new Error('POLICY_REFUSED')
    const url = new URL(base)
    url.pathname = `${base.pathname.replace(/\/$/, '')}${path}`
    const signal = AbortSignal.any([host.signal, AbortSignal.timeout(Math.max(100, Math.min(host.timeoutMs, 15_000)))])
    const response = await fetcher(url, { method, redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(profile.token ? { Authorization: `Bearer ${profile.token}` } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) { await response.body?.cancel(); throw new Error(`PROVIDER_OFFLINE: HTTP ${response.status}`) }
    onHeaders?.(response.headers)
    if (response.status === 202 || response.status === 204) { await response.body?.cancel(); return null }
    const maximum = Math.min(2_000_000, Math.max(32_000, host.maxTokens * 20))
    const reader = response.body?.getReader()
    if (!reader) throw new Error('INVALID_RESPONSE')
    const chunks: Uint8Array[] = []
    let length = 0
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        length += chunk.value.byteLength
        if (length > maximum) throw new Error('BUDGET_LIMIT')
        chunks.push(chunk.value)
      }
    } finally { await reader.cancel(); reader.releaseLock() }
    host.signal.throwIfAborted()
    if (!host.authorised()) throw new Error('POLICY_REFUSED')
    const text = Buffer.concat(chunks).toString('utf8')
    if ((response.headers.get('Content-Type') ?? '').includes('text/event-stream')) {
      // Only a completed JSON-RPC response is accepted. Event-stream support
      // does not expose server notifications as actions or context.
      const messages = text.split(/\r?\n\r?\n/).flatMap(event => {
        const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
        return data ? [JSON.parse(data)] : []
      })
      return messages.find(message => Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error')) ?? null
    }
    return JSON.parse(text)
  }
}
