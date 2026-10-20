import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMain } from 'electron'
const state = vi.hoisted(() => ({ path: '', packaged: true, version: '1.0.0', fetch: vi.fn(), open: vi.fn(), close: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => state.path, getVersion: () => state.version, get isPackaged() { return state.packaged } }, net: { fetch: state.fetch }, shell: { openExternal: state.open }, BrowserWindow: { fromWebContents: () => ({ close: state.close }) } }))
import { registerAppUpdates } from './app-updates'
import type { AppUpdateStatus } from '../../src/lib/app-updates'
let handlers: Map<string, (...args: unknown[]) => unknown>
const call = async <T = AppUpdateStatus>(name: string, arg?: unknown): Promise<T> => handlers.get(`updates:${name}`)!({ sender: {} }, arg) as Promise<T>
const html = (version = '2.0.0') => `<h1>Source release 99.0.0</h1><a class="download-card" href="download.php?file=ouRGeo-${version}.AppImage">Linux</a><a class="download-card" href="download.php?file=ouRGeo-${version}.exe">Windows</a>`
function register() { handlers = new Map(); registerAppUpdates({ handle: (name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler) } as unknown as IpcMain) }
beforeEach(async () => {
  vi.stubGlobal('process', Object.create(process, { platform: { value: 'linux' }, arch: { value: 'x64' }, env: { value: { ...process.env, APPIMAGE: '/tmp/test-ouRGeo.AppImage' } } }))
  state.path = await mkdtemp(join(tmpdir(), 'ourgeo-app-updates-')); state.packaged = true; state.version = '1.0.0'
  state.fetch.mockReset().mockImplementation(async (_url, init) => new Response(init?.method === 'HEAD' ? null : html(), { status: 200 }))
  state.open.mockReset().mockResolvedValue(undefined); state.close.mockReset(); register()
})
afterEach(async () => { await rm(state.path, { recursive: true, force: true }); vi.unstubAllGlobals() })
it('checks once on startup, validates the installer with HEAD, and opens only a selected trusted destination', async () => {
  const result = await call('check', 'startup')
  expect(result.state).toBe('available'); expect(result.latestVersion).toBe('2.0.0')
  expect(state.fetch).toHaveBeenCalledTimes(2)
  expect(state.fetch.mock.calls[1][1].method).toBe('HEAD')
  await call('check', 'startup'); expect(state.fetch).toHaveBeenCalledTimes(2)
  await expect(call('open', 'https://evil.test/setup.exe')).rejects.toThrow('Choose an installer')
  await call('open', result.downloads[0].format)
  expect(state.open).toHaveBeenCalledExactlyOnceWith(result.downloads[0].url)
  expect(state.close).not.toHaveBeenCalled()
  await call('quit'); expect(state.close).toHaveBeenCalledTimes(1)
})
it('keeps current/ahead builds quiet without probing or downloading any binaries', async () => {
  state.version = '2.0.0'; register()
  expect((await call('check', 'startup')).state).toBe('current')
  expect(state.fetch).toHaveBeenCalledTimes(1)
  state.version = '3.0.0'; state.fetch.mockClear(); register()
  expect((await call('check', 'startup')).state).toBe('current')
  expect(state.fetch).toHaveBeenCalledTimes(1)
  expect(state.open).not.toHaveBeenCalled()
})
it('persists skip and automatic preferences across overlapping writes and honours opt-out only for startup', async () => {
  await Promise.all([call('preferences', { automatic: false }), call('preferences', { skippedVersion: '2.0.0' })])
  expect(JSON.parse(await readFile(join(state.path, 'app-updates.json'), 'utf8'))).toEqual({ automatic: false, skippedVersion: '2.0.0' })
  register()
  await call('check', 'startup'); expect(state.fetch).not.toHaveBeenCalled()
  expect((await call('check', 'manual')).state).toBe('available')
})
it('does not check development builds at startup and explains the source update path manually', async () => {
  state.packaged = false; register()
  await call('check', 'startup'); expect(state.fetch).not.toHaveBeenCalled()
  expect((await call('check', 'manual')).state).toBe('development')
  await expect(call('open', 'AppImage')).rejects.toThrow('Check for updates')
})
it('reports offline, missing and oversized pages without inventing an up-to-date result', async () => {
  state.fetch.mockRejectedValueOnce(new Error('Offline'))
  expect((await call('check', 'manual')).state).toBe('error')
  state.fetch.mockResolvedValueOnce(new Response('No installers'))
  expect((await call('check', 'manual')).state).toBe('error')
  state.fetch.mockResolvedValueOnce(new Response('x'.repeat(1_048_577)))
  expect((await call('check', 'manual')).state).toBe('error')
  expect(state.open).not.toHaveBeenCalled()
})
it('rejects broken advertised installers and invalid preference mutations', async () => {
  state.fetch.mockResolvedValueOnce(new Response(html())).mockResolvedValueOnce(new Response(null, { status: 404 }))
  expect((await call('check', 'manual')).state).toBe('error')
  await expect(call('preferences', { automatic: 'yes' })).rejects.toThrow('invalid')
  await expect(call('preferences', { skippedVersion: '../version' })).rejects.toThrow('invalid')
})
