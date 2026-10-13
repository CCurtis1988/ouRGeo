import { afterEach, expect, it } from 'vitest'
import { createServer, type Server, type RequestListener } from 'node:http'
import { gzipSync } from 'node:zlib'
import { localHttpFetch, loopbackHttpUrl } from './local-http'

const servers: Server[] = []
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) } })
async function fixture(handler: RequestListener): Promise<string> {
  const server = createServer(handler); servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`
}

it('routes only literal loopback HTTP and canonical local names without DNS', () => {
  expect(loopbackHttpUrl('http://localhost:1234/a')?.hostname).toBe('127.0.0.1')
  expect(loopbackHttpUrl('http://worker.localhost/a')?.hostname).toBe('127.0.0.1')
  expect(loopbackHttpUrl('http://[::1]/a')?.hostname).toBe('[::1]')
  for (const url of ['https://localhost/a', 'http://127.example/a', 'http://192.168.1.2/a', 'http://example.com/a', 'http://user:secret@localhost/a']) expect(loopbackHttpUrl(url)).toBeNull()
})

it('preserves streaming bytes, request headers and delayed response headers', async () => {
  const base = await fixture((req, res) => {
    expect(req.headers['x-test']).toBe('local')
    expect(req.method).toBe('POST')
    let body = ''; req.on('data', chunk => { body += chunk })
    req.on('end', () => { expect(body).toBe('request'); setTimeout(() => { res.writeHead(201); res.write(Buffer.from([0, 255, 195])); setTimeout(() => res.end(Buffer.from([169])), 20) }, 20) })
  })
  const reply = await localHttpFetch(base, { method: 'POST', body: 'request', headers: { 'X-test': 'local' } })
  expect(reply.status).toBe(201)
  expect([...new Uint8Array(await reply.arrayBuffer())]).toEqual([0, 255, 195, 169])
})

it('decodes compressed output and handles HEAD and empty responses', async () => {
  const base = await fixture((req, res) => {
    if (req.url === '/empty') { res.writeHead(204); res.end(); return }
    const body = gzipSync('complete unicode output: café')
    res.writeHead(200, { 'Content-Encoding': 'gzip', 'Content-Length': body.length }); res.end(req.method === 'HEAD' ? undefined : body)
  })
  const reply = await localHttpFetch(base)
  expect(await reply.text()).toBe('complete unicode output: café')
  expect(reply.headers.has('content-length')).toBe(false)
  expect((await localHttpFetch(base, { method: 'HEAD' })).body).toBeNull()
  expect((await localHttpFetch(base + '/empty')).status).toBe(204)
})

it('follows only same-origin local redirects and refuses remote or cross-port destinations', async () => {
  const base = await fixture((req, res) => {
    if (req.url === '/final') { res.end(req.method); return }
    res.writeHead(302, { Location: req.url === '/remote' ? 'http://198.51.100.42/' : req.url === '/port' ? 'http://127.0.0.1:1/' : '/final' }); res.end()
  })
  expect(await (await localHttpFetch(base, { method: 'POST', body: 'secret' })).text()).toBe('GET')
  await expect(localHttpFetch(base + '/remote')).rejects.toThrow('same loopback origin')
  await expect(localHttpFetch(base + '/port')).rejects.toThrow('same loopback origin')
  await expect(localHttpFetch(base, { redirect: 'error' })).rejects.toThrow('redirected')
  expect((await localHttpFetch(base, { redirect: 'manual' })).status).toBe(302)
})

it('cancels a pending response and reports a severed stream instead of completing it', async () => {
  const base = await fixture((req, res) => {
    if (req.url === '/pending') return
    res.write('partial'); setTimeout(() => res.destroy(), 20)
  })
  const abort = new AbortController(), pending = localHttpFetch(base + '/pending', { signal: abort.signal })
  abort.abort(); await expect(pending).rejects.toThrow()
  const reply = await localHttpFetch(base)
  await expect(reply.text()).rejects.toThrow()
})

it('closes the original socket when decoded compressed output is cancelled', async () => {
  let closed: () => void
  const disconnected = new Promise<void>(resolve => { closed = resolve })
  const base = await fixture((_req, res) => {
    res.on('close', () => closed())
    res.writeHead(200, { 'Content-Encoding': 'gzip' }); res.write(gzipSync('synthetic partial output'))
  })
  const reader = (await localHttpFetch(base)).body!.getReader()
  expect((await reader.read()).done).toBe(false)
  await reader.cancel()
  await disconnected
})
