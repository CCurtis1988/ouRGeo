import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRuntime, mnemosyneEnvironment } from './runtimes'

const configuration = { executable: '/private/python', arguments: ['-I', '-S', '/private/bridge.py'], directory: '/private', environment: {}, profile: 'fixture' }
const host = () => ({ signal: new AbortController().signal, timeoutMs: 1000, authorised: () => true })
afterEach(() => vi.useRealTimers())

function processFixture(ready = true) {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null,
    kill: vi.fn(() => { queueMicrotask(() => child.emit('close', 0)); return true }) }) as unknown as ChildProcessWithoutNullStreams & { stdout: PassThrough }
  const respond = (value: unknown): void => { child.stdout.write(JSON.stringify(value) + '\n') }
  const launch = vi.fn(() => { if (ready) queueMicrotask(() => respond({ ready: true, protocol: 1, profile: 'fixture' })); return child })
  return { child, launch, respond }
}

it('shares one readiness handshake and keeps concurrent replies paired', async () => {
  const { child, launch, respond } = processFixture()
  child.stdin.on('data', data => { const request = JSON.parse(String(data)); respond({ id: request.id, ok: true, result: request.payload }) })
  const runtime = new MemoryRuntime(configuration, launch)
  try {
    expect(await Promise.all([runtime.request('one', host()), runtime.request('two', host())])).toEqual(['one', 'two'])
    expect(launch).toHaveBeenCalledOnce()
  } finally { await runtime.stop() }
})

it('does not spawn a child after cancellation during queued startup', async () => {
  const { launch } = processFixture()
  const runtime = new MemoryRuntime(configuration, launch), abort = new AbortController()
  const request = runtime.request({}, { ...host(), signal: abort.signal })
  abort.abort()
  await expect(request).rejects.toThrow('cancelled')
  expect(launch).not.toHaveBeenCalled()
})

it('kills an in-flight operation and rejects late bytes after revocation', async () => {
  const { child, launch, respond } = processFixture()
  let sent!: { id: number }, authorised = true
  child.stdin.on('data', data => { sent = JSON.parse(String(data)) })
  const runtime = new MemoryRuntime(configuration, launch)
  const request = runtime.request({}, { ...host(), authorised: () => authorised })
  await vi.waitFor(() => expect(sent).toBeDefined())
  authorised = false
  respond({ id: sent.id, ok: true, result: 'private bytes' })
  await expect(request).rejects.toThrow('POLICY_REFUSED')
  expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  await runtime.stop()
})

it.each(['oversized', 'malformed', 'wrong-id'])('stops a runtime returning %s content', async kind => {
  const { child, launch } = processFixture()
  child.stdin.on('data', () => { child.stdout.write(kind === 'oversized' ? 'x'.repeat(128001) : kind === 'malformed' ? 'not JSON\n' : '{"id":999,"ok":true}\n') })
  const runtime = new MemoryRuntime(configuration, launch)
  await expect(runtime.request({}, host())).rejects.toThrow(/exceeded|malformed|outstanding/)
  expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  await runtime.stop()
})

it('bounds startup and restarts only after the previous child closes', async () => {
  const { launch, child } = processFixture(false)
  const runtime = new MemoryRuntime(configuration, launch)
  await expect(runtime.request({}, { ...host(), timeoutMs: 20 })).rejects.toThrow(/timed out|cancelled/)
  expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  await runtime.stop()
})

it('does not inherit model credentials, proxy settings or user Python paths', () => {
  vi.stubEnv('OPENAI_API_KEY', 'private')
  vi.stubEnv('PYTHONPATH', '/private/user/code')
  vi.stubEnv('HTTP_PROXY', 'https://private')
  const environment = mnemosyneEnvironment('/private/data')
  expect(environment.MNEMOSYNE_NO_EMBEDDINGS).toBe('1')
  expect(environment.OPENAI_API_KEY).toBeUndefined()
  expect(environment.PYTHONPATH).toBeUndefined()
  expect(environment.HTTP_PROXY).toBeUndefined()
  vi.unstubAllEnvs()
})

it('stops an idle runtime after the last completed operation', async () => {
  const { child, launch, respond } = processFixture()
  child.stdin.on('data', data => { respond({ id: JSON.parse(String(data)).id, ok: true, result: null }) })
  const runtime = new MemoryRuntime(configuration, launch, 10)
  await runtime.request({}, host())
  await vi.waitFor(() => expect(child.kill).toHaveBeenCalledWith('SIGTERM'))
  await runtime.stop()
})
