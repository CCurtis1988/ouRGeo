import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { ThemeImageFolder } from '../../../src/lib/theme-backgrounds-types'

const mocks = vi.hoisted(() => ({
  path: '',
  chosen: [] as string[],
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  request: undefined as undefined | ((request: Request) => Promise<Response>),
  owner: {} as unknown,
  changed: vi.fn(),
}))
vi.mock('electron', () => ({
  app: { getPath: () => mocks.path },
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: mocks.changed } }] },
  dialog: { showOpenDialog: async () => ({ canceled: !mocks.chosen.length, filePaths: mocks.chosen }) },
  protocol: { handle: (_scheme: string, callback: (request: Request) => Promise<Response>) => { mocks.request = callback } },
}))
vi.mock('../context/ipc', () => ({
  requireContextOwner: (event: unknown) => { if (event !== mocks.owner) throw new Error('Main workspace only') },
}))
import { registerThemeBackgrounds } from './ipc'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLTsAAAAASUVORK5CYII=', 'base64')
async function invoke(name: string, ...args: unknown[]): Promise<unknown> { return mocks.handlers.get(`themeBackgrounds:${name}`)!(mocks.owner, ...args) }
beforeEach(async () => {
  mocks.path = await mkdtemp(join(tmpdir(), 'ourgeo-theme-ipc-'))
  mocks.chosen = []
  mocks.handlers.clear(); mocks.changed.mockClear()
  registerThemeBackgrounds({ handle: (name: string, callback: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>) => mocks.handlers.set(name, callback as (event: unknown, ...args: unknown[]) => Promise<unknown>) } as unknown as IpcMain)
})
afterEach(async () => { await rm(mocks.path, { recursive: true, force: true }) })

describe('theme image folder IPC and protocol', () => {
  it('requires the main workspace for every folder operation', () => {
    expect(mocks.handlers.size).toBe(5)
    for (const handler of mocks.handlers.values()) expect(() => handler({})).toThrow('Main workspace only')
  })

  it('does not grant any disk access when the native picker is cancelled', async () => {
    expect(await invoke('link', 'forest')).toBeNull()
    expect(await invoke('list')).toEqual([])
  })

  it('serves only authorised raster bytes and revokes the protocol route after forgetting the folder', async () => {
    const source = join(mocks.path, 'photos')
    await mkdir(source); await writeFile(join(source, 'still.png'), PNG)
    mocks.chosen = [source]
    const folder = await invoke('link', 'forest') as ThemeImageFolder
    const url = folder.images[0].url
    const response = await mocks.request!(new Request(url))
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG)
    const packagedFetch = await mocks.request!(new Request(url, { headers: { Origin: 'null' } }))
    expect(packagedFetch.headers.get('Access-Control-Allow-Origin')).toBe('null')
    await packagedFetch.arrayBuffer()
    const remoteFetch = await mocks.request!(new Request(url, { headers: { Origin: 'https://untrusted.example' } }))
    expect(remoteFetch.headers.has('Access-Control-Allow-Origin')).toBe(false)
    await remoteFetch.arrayBuffer()
    expect((await mocks.request!(new Request(`${url.split('?')[0]}/../../etc/passwd`))).status).toBe(404)
    expect((await mocks.request!(new Request('ourgeo-theme-image://other/secret.png'))).status).toBe(404)
    expect((await mocks.request!(new Request(url, { method: 'POST' }))).status).toBe(405)
    await invoke('forget', folder.id)
    expect((await mocks.request!(new Request(url))).status).toBe(404)
    expect(await readFile(join(source, 'still.png'))).toEqual(PNG)
    expect(mocks.changed).toHaveBeenCalledWith('themeBackgrounds:changed')
  })
})
