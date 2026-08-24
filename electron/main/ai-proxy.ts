import type { IpcMain, WebContents } from 'electron'

// Proxies AI-provider HTTP calls through the main process so the renderer no
// longer needs `webSecurity: false` to reach external APIs. The renderer sends
// an `ai:fetch` with a request id; we stream the response body back as
// `ai:chunk:<id>` events, then signal completion via `ai:done:<id>` (or
// `ai:error:<id>`). `ai:abort` cancels an in-flight request.

interface ProxyRequest {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
}

const controllers = new Map<string, AbortController>()

function send(wc: WebContents, channel: string, ...args: unknown[]): void {
  if (!wc.isDestroyed()) wc.send(channel, ...args)
}

export function registerAiProxy(ipcMain: IpcMain): void {
  ipcMain.on('ai:fetch', async (event, id: string, req: ProxyRequest) => {
    const wc = event.sender
    const controller = new AbortController()
    controllers.set(id, controller)
    try {
      const res = await fetch(req.url, {
        method: req.method ?? 'GET',
        headers: req.headers,
        body: req.body,
        signal: controller.signal,
      })
      send(wc, `ai:meta:${id}`, { ok: res.ok, status: res.status })

      if (res.body) {
        const reader = res.body.getReader()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (wc.isDestroyed()) {
            controller.abort()
            break
          }
          // Send a tight copy so structured clone doesn't ship the whole
          // underlying buffer the undici view may point into.
          if (value) send(wc, `ai:chunk:${id}`, value.slice())
        }
      }
      send(wc, `ai:done:${id}`)
    } catch (err) {
      send(wc, `ai:error:${id}`, err instanceof Error ? err.message : String(err))
    } finally {
      controllers.delete(id)
    }
  })

  ipcMain.on('ai:abort', (_event, id: string) => {
    controllers.get(id)?.abort()
  })
}
