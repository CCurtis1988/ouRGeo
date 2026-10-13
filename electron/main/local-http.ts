import { request } from 'node:http'
import { isIP } from 'node:net'
import { Readable } from 'node:stream'
import { createUnzip } from 'node:zlib'

/** Chromium probes an external IPv6 route even for literal loopback requests.
 * Keep deliberately local HTTP on Node's request API, whose header/body waits
 * have no hidden five-minute model deadline. No DNS or proxy is consulted. */
export function loopbackHttpUrl(input: string): URL | null {
  const url = new URL(input), host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (url.protocol !== 'http:' || url.username || url.password) return null
  if (host === 'localhost' || host.endsWith('.localhost')) { url.hostname = '127.0.0.1'; return url }
  return host === '::1' || isIP(host) === 4 && host.startsWith('127.') ? url : null
}

export async function localHttpFetch(input: string, init: RequestInit = {}, redirects = 0): Promise<Response> {
  const url = loopbackHttpUrl(input)
  if (!url) throw new Error('Choose an HTTP loopback endpoint for local requests.')
  init.signal?.throwIfAborted()
  const headers = new Headers(init.headers)
  // Preserve virtual hosts while connecting to a literal loopback address.
  if (new URL(input).hostname !== url.hostname) headers.set('Host', new URL(input).host)
  const body = init.body
  if (body != null && typeof body !== 'string' && !(body instanceof Uint8Array) && !(body instanceof ArrayBuffer)) throw new Error('Local HTTP requires a string or byte request body.')
  return new Promise<Response>((resolve, reject) => {
    const req = request(url, { method: init.method ?? 'GET', headers: Object.fromEntries(headers), signal: init.signal ?? undefined, agent: false }, res => {
      const status = res.statusCode ?? 500, responseHeaders = new Headers()
      for (const [key, value] of Object.entries(res.headers)) if (value !== undefined) responseHeaders.set(key, Array.isArray(value) ? value.join(', ') : value)
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && init.redirect !== 'manual') {
        res.resume()
        if (init.redirect === 'error') { reject(new Error('The local endpoint redirected. Use its final address.')); return }
        const destination = new URL(res.headers.location, input)
        if (redirects >= 20 || !loopbackHttpUrl(destination.href) || destination.origin !== new URL(input).origin) { reject(new Error('Local redirects must stay at the same loopback origin. Use the final endpoint address.')); return }
        const changeMethod = status === 303 && init.method !== 'HEAD' || [301, 302].includes(status) && init.method === 'POST'
        const nextHeaders = new Headers(headers)
        if (changeMethod) { nextHeaders.delete('content-type'); nextHeaders.delete('content-length') }
        resolve(localHttpFetch(destination.href, { ...init, headers: nextHeaders, ...(changeMethod ? { method: 'GET', body: undefined } : {}) }, redirects + 1)); return
      }
      responseHeaders.delete('transfer-encoding')
      const empty = init.method === 'HEAD' || [204, 205, 304].includes(status)
      let stream: Readable = res
      if (!empty && /^(gzip|deflate)$/i.test(responseHeaders.get('content-encoding') ?? '')) {
        stream = res.pipe(createUnzip()); res.on('error', error => stream.destroy(error))
        // Cancelling decoded output must close the original socket too; merely
        // destroying the unzip stream can leave a model request running.
        stream.once('close', () => { if (!res.complete) res.destroy() })
        responseHeaders.delete('content-encoding'); responseHeaders.delete('content-length')
      }
      if (empty) res.resume()
      resolve(new Response(empty ? null : Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, statusText: res.statusMessage, headers: responseHeaders }))
    })
    req.on('error', reject)
    req.end(body instanceof ArrayBuffer ? Buffer.from(body) : body)
  })
}
