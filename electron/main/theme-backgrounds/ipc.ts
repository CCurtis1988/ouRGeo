import { app, BrowserWindow, dialog, protocol, type IpcMain } from 'electron'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { requireContextOwner } from '../context/ipc'
import { ThemeBackgroundLibrary } from './library'

export const THEME_BACKGROUNDS_SCHEME = { scheme: 'ourgeo-theme-image', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }

export function registerThemeBackgrounds(ipc: IpcMain): void {
  const service = new ThemeBackgroundLibrary(join(app.getPath('userData'), 'theme-background-folders.json'), () => {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('themeBackgrounds:changed')
  })
  const register = (name: string, callback: (...args: never[]) => unknown): void => {
    ipc.handle(`themeBackgrounds:${name}`, (event, ...args) => { requireContextOwner(event); return callback(...args as never[]) })
  }
  register('list', () => service.list())
  register('link', async (themeId: string) => {
    const selection = await dialog.showOpenDialog({ title: 'Link image folder to theme', properties: ['openDirectory'] })
    return selection.canceled || !selection.filePaths[0] ? null : service.link(themeId, selection.filePaths[0])
  })
  register('rescan', (id: string) => service.rescan(id))
  register('relink', async (id: string) => {
    const existing = (await service.list()).find(folder => folder.id === id)
    if (!existing) throw new Error('This image folder is no longer linked. Link it again in Backgrounds.')
    const selection = await dialog.showOpenDialog({ title: `Locate ${existing.name}`, defaultPath: existing.path, properties: ['openDirectory'] })
    return selection.canceled || !selection.filePaths[0] ? null : service.relink(id, selection.filePaths[0])
  })
  register('forget', (id: string) => service.forget(id))

  protocol.handle(THEME_BACKGROUNDS_SCHEME.scheme, async request => {
    if (request.method !== 'GET') return new Response(null, { status: 405 })
    const url = new URL(request.url)
    if (url.hostname !== 'image' || url.username || url.password || url.port) return new Response(null, { status: 404 })
    let id: string
    try { id = decodeURIComponent(url.pathname.slice(1)) } catch { return new Response(null, { status: 404 }) }
    if (!/^folder:[a-f0-9-]{36}:[a-f0-9]{24}$/.test(id)) return new Response(null, { status: 404 })
    try {
      const image = await service.image(id)
      // The gallery decodes an animated file's first frame in Chromium rather
      // than blocking Electron's main thread. That fetch crosses schemes even
      // for file://, so opt in only to the packaged or configured dev origin.
      const origin = request.headers.get('Origin')
      let developmentOrigin: string | undefined
      try { if (process.env.ELECTRON_RENDERER_URL) developmentOrigin = new URL(process.env.ELECTRON_RENDERER_URL).origin } catch { /* A malformed dev URL is not a trusted origin. */ }
      const cors: Record<string, string> = origin === 'null' || origin && origin === developmentOrigin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}
      return new Response(Readable.toWeb(image.file.createReadStream()) as ReadableStream<Uint8Array>, {
        headers: {
          ...cors,
          'Content-Type': image.info.mime,
          'Content-Length': String(image.bytes),
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox",
        },
      })
    } catch { return new Response(null, { status: 404 }) }
  })
}
