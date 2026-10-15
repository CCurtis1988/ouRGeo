import { afterEach, expect, it, vi } from 'vitest'
import { MnemosyneLocalServer, type LocalServerRuntime } from './local-server'
import type { MemoryConnection } from '../../../../src/lib/context/providers/connections'
import { request as httpRequest } from 'node:http'
const servers: MnemosyneLocalServer[] = []
afterEach(async () => { for (const server of servers.splice(0)) await server.close() })
async function fixture() {
  const request = vi.fn<LocalServerRuntime['request']>(async () => ({ status: 'ok', synthetic: true })), server = new MnemosyneLocalServer({ request }); servers.push(server)
  const id = crypto.randomUUID(), namespace = crypto.randomUUID(), registration = await server.register(id, namespace, 'global')
  const call = (body: unknown, token = registration.token, headers = {}) => fetch(`${registration.endpoint}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...headers }, body: JSON.stringify(body) })
  const connection = { id, namespaceRef: namespace, location: 'loopback', adapter: 'mnemosyne', endpoint: registration.endpoint, scope: 'global', credentialRef: crypto.randomUUID() } as MemoryConnection
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
