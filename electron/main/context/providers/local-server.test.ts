import { afterEach, expect, it, vi } from 'vitest'
import { MnemosyneLocalServer, type LocalServerRuntime } from './local-server'
import type { MemoryConnection } from '../../../../src/lib/context/providers/connections'
import { request as httpRequest } from 'node:http'
import { createMnemosyneMcpCall } from './mnemosyne'
import { createJsonTransport } from './transport'
const servers: MnemosyneLocalServer[] = []
afterEach(async () => { for (const server of servers.splice(0)) await server.close() })
async function fixture() {
  const request = vi.fn<LocalServerRuntime['request']>(async () => ({ status: 'ok', synthetic: true })), server = new MnemosyneLocalServer({ request }); servers.push(server)
  const id = crypto.randomUUID(), namespace = crypto.randomUUID(), registration = await server.register(id, namespace, 'global')
  const call = (body: unknown, token = registration.token, headers = {}) => fetch(`${registration.endpoint}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...headers }, body: JSON.stringify(body) })
  const connection = { id, namespaceRef: namespace, location: 'loopback', adapter: 'mnemosyne', endpoint: registration.mcpEndpoint, scope: 'global', credentialRef: crypto.randomUUID() } as MemoryConnection
  return { server, request, id, namespace, registration, call, connection }
}
it('requires secret authentication and the registered namespace before invoking the native runtime', async () => {
  const { server, request, namespace, call, connection } = await fixture()
  expect(server.owns(connection)).toBe(true)
  for (const [body, token] of [[{ operation: 'probe', namespace }, 'wrong'], [{ operation: 'probe', namespace: crypto.randomUUID() }, undefined], [{ operation: 'system', namespace }, undefined]] as const) expect((await call(body, token)).status).toBe(403)
  expect(request).not.toHaveBeenCalled()
  expect(await (await call({ operation: 'probe', namespace })).json()).toEqual({ status: 'ok', synthetic: true })
  expect(request.mock.calls[0][1]).toMatchObject({ namespace, paidProcessingAllowed: false })
})
it('refuses browser preflight, foreign Host values and malformed or oversized bodies', async () => {
  const { request, registration, call, namespace } = await fixture()
  expect((await fetch(`${registration.endpoint}/rpc`, { method: 'OPTIONS' })).status).toBe(403)
  const foreignHost = await new Promise<number | undefined>((resolve, reject) => {
    const incoming = httpRequest(`${registration.endpoint}/rpc`, { method: 'POST', headers: { Host: 'attacker.example', 'Content-Type': 'application/json', Authorization: `Bearer ${registration.token}` } }, response => { response.resume(); resolve(response.statusCode) })
    incoming.on('error', reject); incoming.end(JSON.stringify({ operation: 'probe', namespace }))
  })
  expect(foreignHost).toBe(403)
  expect((await call({ operation: 'probe', namespace, text: 'x'.repeat(4_000_001) })).status).toBe(413)
  expect(request).not.toHaveBeenCalled()
})
it('revokes in-flight authority and refuses retained credentials without exposing runtime failures', async () => {
  const { server, request, id, namespace, call, connection } = await fixture()
  request.mockImplementationOnce(async (_payload, host) => { server.revoke(id); expect(host.authorised()).toBe(false); return { status: 'ok', synthetic: true } })
  expect((await call({ operation: 'probe', namespace })).status).toBe(403)
  expect(server.owns(connection)).toBe(false)
  expect((await call({ operation: 'probe', namespace })).status).toBe(403)
})
it('checks native mutation authority and rechecks it after backend work', async () => {
  let allowed = true
  const request = vi.fn<LocalServerRuntime['request']>(async () => { allowed = false; return { sensitive: 'must not leave the cancelled invocation' } })
  const server = new MnemosyneLocalServer({ request }, async (_registration, payload) => {
    if (payload.operation === 'replace' && payload.invocationId !== 'approved-private-job') throw new Error('POLICY_REFUSED')
    return () => allowed
  }); servers.push(server)
  const namespace = crypto.randomUUID(), registration = await server.register(crypto.randomUUID(), namespace, 'global')
  const call = (invocationId: string) => fetch(`${registration.endpoint}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${registration.token}` }, body: JSON.stringify({ operation: 'replace', namespace, invocationId }) })
  expect((await call('forged')).status).toBe(403); expect(request).not.toHaveBeenCalled()
  const response = await call('approved-private-job')
  expect(response.status).toBe(403); expect(await response.text()).not.toContain('sensitive')
})
it('rotates credentials when renewing a listener registration and refuses the previous token', async () => {
  const { server, id, namespace, registration, call } = await fixture()
  server.revoke(id)
  const renewed = await server.register(id, namespace, 'global')
  expect(renewed.token).not.toBe(registration.token)
  expect((await call({ operation: 'probe', namespace })).status).toBe(403)
  expect((await call({ operation: 'probe', namespace }, renewed.token)).status).toBe(200)
})
it('serves standard MCP lifecycle and bounded bank tools with Origin and protocol validation', async () => {
  const { request, namespace, registration } = await fixture()
  request.mockResolvedValue({ generation: 1, evidence: [], complete: true })
  const headers = { Authorization: `Bearer ${registration.token}`, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' }
  expect((await fetch(registration.mcpEndpoint, { headers: { ...headers, Accept: 'text/event-stream' } })).status).toBe(405)
  expect((await fetch(registration.mcpEndpoint, { method: 'POST', headers: { ...headers, Origin: 'https://attacker.invalid' }, body: '{}' })).status).toBe(403)
  expect((await fetch(registration.mcpEndpoint, { method: 'POST', headers: { ...headers, 'MCP-Protocol-Version': 'unreviewed' }, body: '{}' })).status).toBe(400)
  const call = createMnemosyneMcpCall(createJsonTransport({ endpoint: registration.mcpEndpoint, local: true, token: registration.token }))
  const host = { namespace, signal: new AbortController().signal, policyRevision: 1, idempotencyKey: crypto.randomUUID(), timeoutMs: 5000, maxTokens: 2000, maxResults: 5, paidProcessingAllowed: false, authorised: () => true }
  expect(await call('mnemosyne_stats', { bank: namespace }, host)).toEqual({ status: 'ok', bank: namespace })
  await expect(call('ourgeo_mnemosyne_snapshot', { bank: namespace, namespace, operation: 'probe' }, host)).rejects.toThrow('POLICY_REFUSED')
  expect(request).toHaveBeenCalledOnce()
})
