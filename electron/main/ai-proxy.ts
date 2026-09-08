import { net } from 'electron'
import type { IpcMain, WebContents } from 'electron'
import { describeFetchFailure, isLoopbackHost } from '../../src/lib/ai-fetch-error'

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
      // `net.fetch` (Chromium's stack), NOT Node's global fetch.
      //
      // Node's fetch is undici, whose `headersTimeout` and `bodyTimeout` are
      // both five minutes, and a local model routinely exceeds that: a large
      // prompt on a busy GPU can take longer than five minutes to produce its
      // first byte, and a second request queued behind one waits for the whole
      // of it. Measured against a server holding its headers for 320 s: Node's
      // fetch threw at 300.8 s with `UND_ERR_HEADERS_TIMEOUT`, which reached
      // the chat panel as the whole of the message "fetch failed"; `net.fetch`
      // returned the answer.
      //
      // So ouRGeo no longer imposes a deadline of its own on a request the
      // user can see and stop. Streaming, custom headers and AbortSignal all
      // behave the same here — that was verified before the swap, not assumed.
      const res = await net.fetch(req.url, {
        method: req.method ?? 'GET',
        headers: req.headers,
        body: req.body,
        signal: controller.signal,
      })
      send(wc, `ai:meta:${id}`, { ok: res.ok, status: res.status })

      if (res.body) {
        const reader = res.body.getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (wc.isDestroyed()) {
            controller.abort()
            break
          }
          // Send a tight copy so structured clone doesn't ship the whole
          // underlying buffer the view may point into.
          if (value) send(wc, `ai:chunk:${id}`, value.slice())
        }
      }
      send(wc, `ai:done:${id}`)
    } catch (err) {
      // An abort is the renderer having said so, and it has already torn its
      // own listeners down and settled its promise — anything sent here would
      // land on nothing. Only a real failure is worth reporting.
      if (!controller.signal.aborted) {
        send(wc, `ai:error:${id}`, describeFetchFailure(req.url, err, isLoopbackHost(req.url)))
      }
    } finally {
      controllers.delete(id)
    }
  })

  ipcMain.on('ai:abort', (_event, id: string) => {
    controllers.get(id)?.abort()
  })
}
