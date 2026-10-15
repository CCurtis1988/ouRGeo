import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ dir: '', crash: false, forks: [] as unknown[] }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class Child extends EventEmitter {
    stdout = { resume() {} }
    stderr = new EventEmitter()
    stopped = false
    postMessage(data: { type: string }): void { if (data.type === 'stop') { this.stopped = true; queueMicrotask(() => this.emit('exit', 0)) } }
    kill(): boolean { this.stopped = true; queueMicrotask(() => this.emit('exit', 1)); return true }
  }
  return {
    app: { getPath: () => state.dir }, ipcMain: { handle: vi.fn() },
    utilityProcess: { fork: vi.fn(() => {
      const child = new Child(); state.forks.push(child)
      queueMicrotask(() => state.crash ? child.emit('exit', 1) : child.emit('message', { type: 'ready', connection: { url: 'http://127.0.0.1:45678', token: 'a'.repeat(48) } }))
      return child
    }) },
  }
})
import { startPluginService, stopPluginServices, pluginServicesRunning } from './plugin-services'

function owner(): Parameters<typeof startPluginService>[1] {
  return Object.assign(new EventEmitter(), { isDestroyed: () => false }) as unknown as Parameters<typeof startPluginService>[1]
}
beforeEach(async () => {
  state.dir = await mkdtemp(join(tmpdir(), 'ourgeo-services-')); state.crash = false; state.forks = []
  const dir = join(state.dir, 'plugins', 'media', 'server'); await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'main.mjs'), 'export {}')
  await writeFile(join(state.dir, 'plugins', 'media', 'ourgeo-plugin.json'), JSON.stringify({ id: 'media', permissions: ['service'], service: { entry: 'server/main.mjs', files: ['server/main.mjs'] } }))
  await writeFile(join(state.dir, 'plugins.json'), JSON.stringify({ enabled: { media: true } }))
})
afterEach(async () => { await stopPluginServices(); await rm(state.dir, { recursive: true, force: true }) })
describe('managed plugin services', () => {
  it('refuses a service after its manifest adds an unapproved context permission', async () => {
    const manifest = { id: 'media', permissions: ['service', 'context-source'], service: { entry: 'server/main.mjs', files: ['server/main.mjs'] } }
    await writeFile(join(state.dir, 'plugins', 'media', 'ourgeo-plugin.json'), JSON.stringify(manifest))
    await writeFile(join(state.dir, 'plugins.json'), JSON.stringify({ enabled: { media: true }, permissionGrants: { media: ['service'] } }))
    await expect(startPluginService('media', owner())).rejects.toThrow('Enable')
    expect(state.forks).toHaveLength(0)
  })
  it('deduplicates starts and retains a running service across panel remounts', async () => {
    const window = owner(), a = startPluginService('media', window), b = startPluginService('media', window)
    expect(a).toBe(b)
    const connection = await a
    expect(await startPluginService('media', window)).toEqual(connection)
    expect(state.forks).toHaveLength(1)
    await stopPluginServices(); expect(pluginServicesRunning()).toBe(false)
    expect((state.forks[0] as { stopped: boolean }).stopped).toBe(true)
  })
  it('contains a service crash and permits a fresh start', async () => {
    state.crash = true; const window = owner()
    await expect(startPluginService('media', window)).rejects.toThrow('exited')
    state.crash = false
    expect((await startPluginService('media', window)).url).toContain('127.0.0.1')
    expect(state.forks).toHaveLength(2)
  })
  it('restarts after service code changes and stops when its renderer disappears', async () => {
    const window = owner(); await startPluginService('media', window)
    await writeFile(join(state.dir, 'plugins', 'media', 'server', 'main.mjs'), 'export const changed = true')
    await startPluginService('media', window)
    expect(state.forks).toHaveLength(2)
    window.emit('destroyed'); await stopPluginServices()
    expect(pluginServicesRunning()).toBe(false)
  })
  it('enforces enabled state and real filesystem containment at the execution boundary', async () => {
    const window = owner()
    await expect(startPluginService('../media', window)).rejects.toThrow('Invalid plugin id')
    await writeFile(join(state.dir, 'plugins.json'), JSON.stringify({ enabled: {} }))
    await expect(startPluginService('media', window)).rejects.toThrow('Enable')
    await writeFile(join(state.dir, 'plugins.json'), JSON.stringify({ enabled: { media: true } }))
    const entry = join(state.dir, 'plugins', 'media', 'server', 'main.mjs')
    await rm(entry); await symlink(join(state.dir, 'plugins.json'), entry)
    await expect(startPluginService('media', window)).rejects.toThrow('outside')
    expect(state.forks).toHaveLength(0)
  })
})
