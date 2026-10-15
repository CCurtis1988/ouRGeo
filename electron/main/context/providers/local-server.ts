import { createServer, type Server } from 'node:http'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { MemoryConnection } from '../../../../src/lib/context/providers/connections'
import type { ProviderHost } from '../../../../src/lib/context/providers/types'
import { localMcpPlan, localMcpVersionSupported } from './local-server-mcp'

interface Registration { id: string; namespace: string; scope: MemoryConnection['scope']; tokenHash: Buffer }
export interface LocalServerRuntime {
  request: (payload: Record<string, unknown>, host: ProviderHost) => Promise<unknown>
}
/** Authenticated loopback transport for the reviewed lexical bridge. Listener
 * creation is explicit; built-in memory never starts it. Registrations belong
 * to host-created scopes, not HTTP bodies or plugin self-descriptions. */
export class MnemosyneLocalServer {
  private server?: Server
  private endpoint?: string
  private registrations = new Map<string, Registration>()
  private requests = new Map<AbortController, string | null>()
  private starting?: Promise<void>
  constructor(private runtime: LocalServerRuntime, private authorise?: (registration: Pick<Registration, 'id' | 'namespace' | 'scope'>, payload: Record<string, unknown>) => Promise<() => boolean>) {}
  private async start(): Promise<void> {
    if (this.endpoint) return
    if (this.starting) return this.starting
    this.starting = (async () => {
      const server = createServer((request, response) => {
        if (this.requests.size >= 8) { request.resume(); response.writeHead(503, { 'Content-Type': 'application/json' }); response.end('{"error":"LOCAL_PROFILE_BUSY"}'); return }
        const controller = new AbortController(); this.requests.set(controller, null)
        request.on('aborted', () => controller.abort())
        response.on('close', () => { if (!response.writableEnded) controller.abort() })
        const fail = (status: number): void => { if (!response.headersSent) response.writeHead(status, { 'Content-Type': 'application/json' }); response.end('{"error":"LOCAL_PROFILE_REFUSED"}') }
        void (async () => {
          const address = server.address()
          const mcp = request.url === '/mcp'
          if (!address || typeof address === 'string' || request.headers.host !== `127.0.0.1:${address.port}` || !mcp && request.url !== '/rpc'
            || request.headers.origin !== undefined && request.headers.origin !== `http://127.0.0.1:${address.port}`) return fail(403)
          const authorization = request.headers.authorization
          if (!authorization?.startsWith('Bearer ') || authorization.length > 256) return fail(403)
          const hash = createHash('sha256').update(authorization.slice(7)).digest()
          const registration = [...this.registrations.values()].find(item => timingSafeEqual(item.tokenHash, hash))
          if (!registration) return fail(403)
          this.requests.set(controller, registration.id)
          if (mcp && !localMcpVersionSupported(request.headers['mcp-protocol-version'])) return fail(400)
          if (mcp && request.method === 'GET') { response.writeHead(405, { Allow: 'POST' }); response.end(); return }
          if (request.method !== 'POST' || request.headers['content-type']?.split(';')[0].trim() !== 'application/json') return fail(403)
          if (mcp && (!request.headers.accept?.includes('application/json') || !request.headers.accept.includes('text/event-stream'))) return fail(400)
          if (Number(request.headers['content-length']) > 4_000_000) { request.resume(); return fail(413) }
          const chunks: Buffer[] = []; let bytes = 0
          for await (const chunk of request) { bytes += chunk.length; if (bytes > 4_000_000) { request.resume(); return fail(413) } chunks.push(Buffer.from(chunk)) }
          let input: unknown
          try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) } catch { return fail(400) }
          const plan = mcp ? localMcpPlan(input, registration.namespace) : undefined
          if (plan?.kind === 'reply') { response.writeHead(plan.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(plan.body === undefined ? undefined : JSON.stringify(plan.body)); return }
          const payload = (plan?.kind === 'operation' ? plan.payload : input) as Record<string, unknown>
          if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.namespace !== registration.namespace || typeof payload.operation !== 'string' || !['probe', 'search', 'read', 'replace'].includes(payload.operation)) return fail(403)
          const current = this.authorise ? await this.authorise({ id: registration.id, namespace: registration.namespace, scope: registration.scope }, payload) : () => true
          const authorised = (): boolean => !controller.signal.aborted && this.registrations.get(registration.id) === registration && current()
          if (!authorised()) return fail(403)
          delete payload.invocationId
          const timer = setTimeout(() => controller.abort(), 15000); timer.unref()
          try {
            const result = await this.runtime.request(payload, { namespace: registration.namespace, signal: controller.signal, timeoutMs: 15000, policyRevision: 1,
              maxTokens: 2000, maxResults: 5, idempotencyKey: crypto.randomUUID(), paidProcessingAllowed: false, authorised })
            if (!authorised()) return fail(403)
            const body = JSON.stringify(plan?.kind === 'operation' ? plan.reply(result) : result)
            if (Buffer.byteLength(body) > 2_000_000) return fail(413)
            response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(body)
          } finally { clearTimeout(timer) }
        })().catch(error => fail(error instanceof Error && ['POLICY_REFUSED', 'SCOPE_CHANGED'].includes(error.message) ? 403 : 503)).finally(() => this.requests.delete(controller))
      })
      this.server = server
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() }) })
      server.on('error', () => { for (const controller of this.requests.keys()) controller.abort(); this.registrations.clear(); this.endpoint = undefined })
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Restart the private local memory listener.')
      this.endpoint = `http://127.0.0.1:${address.port}`
    })().finally(() => { this.starting = undefined })
    return this.starting
  }
  async register(id: string, namespace: string, scope: MemoryConnection['scope']): Promise<{ endpoint: string; mcpEndpoint: string; token: string }> {
    if (!/^[a-f0-9-]{36}$/i.test(id) || !/^[a-f0-9-]{36}$/i.test(namespace) || scope !== 'global' && !/^project:[a-f0-9-]{36}$/i.test(scope) || this.registrations.size >= 32 || this.registrations.has(id)) throw new Error('Choose a fresh bounded local-server registration in this scope.')
    await this.start()
    const token = randomBytes(32).toString('base64url')
    this.registrations.set(id, { id, namespace, scope, tokenHash: createHash('sha256').update(token).digest() })
    return { endpoint: this.endpoint!, mcpEndpoint: `${this.endpoint}/mcp`, token }
  }
  owns(connection: MemoryConnection): boolean {
    const registration = this.registrations.get(connection.id)
    return Boolean(registration && connection.location === 'loopback' && connection.adapter === 'mnemosyne' && connection.endpoint === `${this.endpoint}/mcp` && connection.namespaceRef === registration.namespace && connection.scope === registration.scope && connection.credentialRef)
  }
  revoke(id: string): void { this.registrations.delete(id); for (const [request, registration] of this.requests) if (registration === id) request.abort() }
  async close(): Promise<void> {
    this.registrations.clear(); for (const request of this.requests.keys()) request.abort()
    const server = this.server; this.server = undefined; this.endpoint = undefined
    if (server) { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())) }
  }
}
