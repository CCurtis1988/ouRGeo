import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest'
import type { EventEmitter } from 'node:events'

const state = vi.hoisted(() => ({ children: [] as (EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: ReturnType<typeof vi.fn>; killed: boolean })[] }))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))
vi.mock('node:child_process', async () => {
  const { EventEmitter } = await import('node:events')
  return { spawn: () => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(), killed: false })
    state.children.push(child)
    return child
  } }
})
import { rBridge } from './r-bridge'
const ready = () => state.children.at(-1)!.stdout.emit('data', Buffer.from('OURGEO_PORT:43210\nOURGEO_READY\n'))
beforeEach(() => { state.children = []; rBridge.onUnexpectedExit = vi.fn(); vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => { const child = state.children.at(-1); rBridge.stop(); child?.emit('exit', 0); vi.restoreAllMocks() })

describe('R recovery after health-check repairs', () => {
  it('distinguishes startup and deliberate repair stops from an unexpected exit on wake', async () => {
    const started = rBridge.start()
    expect(rBridge.isReady).toBe(false)
    expect(rBridge.shouldRestart).toBe(false)
    ready(); await started
    state.children.at(-1)!.emit('exit', 1)
    expect(rBridge.isReady).toBe(false)
    expect(rBridge.shouldRestart).toBe(true)
    rBridge.stop()
    expect(rBridge.shouldRestart).toBe(false)
    const connected = rBridge.start(); ready(); await connected
    rBridge.stop()
    expect(rBridge.shouldRestart).toBe(false)
  })
  it('accepts readiness markers split across stdout chunks', async () => {
    const started = rBridge.start()
    const child = state.children.at(-1)!
    child.stdout.emit('data', Buffer.from('OURGEO_PO'))
    child.stdout.emit('data', Buffer.from('RT:43210\nOURGEO_REA'))
    child.stdout.emit('data', Buffer.from('DY\n'))
    await started
    expect(rBridge.isReady).toBe(true)
    expect(rBridge.port).toBe(43210)
  })
  it('keeps the replacement process intact when the old process exits during restart', async () => {
    const first = rBridge.start(); ready(); await first
    const old = state.children.at(-1)!
    const second = rBridge.restart()
    old.emit('exit', 0)
    ready(); await second
    expect(rBridge.isReady).toBe(true)
    expect(rBridge.port).toBe(43210)
    expect(rBridge.onUnexpectedExit).not.toHaveBeenCalled()
  })
  it('rejects startup package failures promptly and permits retry without a crash loop', async () => {
    const first = rBridge.start()
    state.children.at(-1)!.emit('exit', 1)
    await expect(first).rejects.toThrow('before connecting')
    expect(rBridge.onUnexpectedExit).not.toHaveBeenCalled()
    const retry = rBridge.start(); ready(); await retry
    expect(rBridge.isReady).toBe(true)
  })
})
