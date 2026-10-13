import { net, protocol, type IpcMain, type WebContents } from 'electron'
import { localHttpFetch, loopbackHttpUrl } from './local-http'

export const fetchWithoutLocalProbes: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (!loopbackHttpUrl(url)) return net.fetch(input instanceof URL ? input.href : input, { ...init, bypassCustomProtocolHandlers: true })
  if (typeof input === 'string' || input instanceof URL) return localHttpFetch(url, init)
  return localHttpFetch(url, { method: input.method, headers: input.headers, signal: input.signal,
    ...(input.method === 'GET' || input.method === 'HEAD' ? {} : { body: await input.arrayBuffer() }), ...init })
}

/** Intercept local HTTP before Chromium resolves it, including R assets and
 * renderer XHR. Remote requests retain Chromium's configured session behaviour. */
export function registerLocalNetwork(ipc: IpcMain, rPort: () => number | null): void {
  protocol.handle('http', request => fetchWithoutLocalProbes(request))
  const sockets = new Map<number, WebSocket>()
  const watched = new Set<number>()
  const send = (wc: WebContents, value: { type: 'open' | 'close' | 'message'; text?: string }): void => {
    if (!wc.isDestroyed()) wc.send('r:consoleEvent', value)
  }
  const close = (id: number): void => { const socket = sockets.get(id); sockets.delete(id); socket?.close() }
  ipc.on('r:consoleConnect', (event, port: unknown) => {
    const wc = event.sender
    close(wc.id)
    // The renderer can connect only to the running R console, never an
    // arbitrary WebSocket or a stale server after R restart.
    if (!Number.isInteger(port) || port !== rPort()) { send(wc, { type: 'close' }); return }
    const socket = new WebSocket(`ws://127.0.0.1:${port}/console`)
    sockets.set(wc.id, socket)
    const current = (): boolean => sockets.get(wc.id) === socket
    socket.addEventListener('open', () => { if (current()) send(wc, { type: 'open' }) })
    socket.addEventListener('message', event => { if (current() && typeof event.data === 'string') send(wc, { type: 'message', text: event.data }) })
    socket.addEventListener('error', () => { if (current()) { sockets.delete(wc.id); send(wc, { type: 'close' }) } })
    socket.addEventListener('close', () => { if (current()) { sockets.delete(wc.id); send(wc, { type: 'close' }) } })
    if (!watched.has(wc.id)) {
      watched.add(wc.id)
      wc.once('destroyed', () => { watched.delete(wc.id); close(wc.id) })
    }
  })
  ipc.on('r:consoleSend', (event, text: unknown) => {
    const socket = sockets.get(event.sender.id)
    if (socket?.readyState === WebSocket.OPEN && typeof text === 'string' && text.length <= 4096) socket.send(text)
  })
  ipc.on('r:consoleClose', event => close(event.sender.id))
}
