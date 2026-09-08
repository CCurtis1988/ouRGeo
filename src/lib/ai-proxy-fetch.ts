// A `fetch`-shaped wrapper over the main-process AI proxy (window.electronAPI.ai.stream).
// It exposes just the surface ai-client.ts uses: `ok`, `status`, `json()`, `text()`
// and `body.getReader()` for streaming. This lets the provider logic stay unchanged
// while the actual network call runs in the main process (so the renderer doesn't
// need webSecurity disabled).

interface ProxyReadResult {
  done: boolean
  value?: Uint8Array
}

export interface ProxyResponse {
  ok: boolean
  status: number
  body: { getReader(): { read(): Promise<ProxyReadResult> } } | null
  json(): Promise<unknown>
  text(): Promise<string>
}

export interface ProxyFetchInit {
  method?: string
  headers?: Record<string, string>
  body?: string
  signal?: AbortSignal
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) { out.set(p, off); off += p.length }
  return out
}

export function proxyFetch(url: string, init: ProxyFetchInit = {}): Promise<ProxyResponse> {
  return new Promise<ProxyResponse>((resolve, reject) => {
    const queue: Uint8Array[] = []
    let waiting: ((r: ProxyReadResult) => void) | null = null
    let ended = false
    let errored: Error | null = null
    let meta: { ok: boolean; status: number } | null = null
    let settled = false
    let failWaiting: ((e: Error) => void) | null = null

    const pushChunk = (c: Uint8Array): void => {
      if (waiting) { const w = waiting; waiting = null; failWaiting = null; w({ done: false, value: c }) }
      else queue.push(c)
    }
    const finish = (): void => {
      ended = true
      if (waiting) { const w = waiting; waiting = null; failWaiting = null; w({ done: true }) }
    }
    /**
     * The stream died after the response had already been handed over.
     *
     * This has to REJECT the pending read, not resolve it as a clean end. It
     * used to call `finish()`, so a connection that dropped half way through
     * an answer was indistinguishable from a server that had finished
     * speaking: the caller returned the truncated text as the complete reply
     * and nothing anywhere said otherwise. A half-answer presented as whole is
     * worse than an error, because only the error can be acted on.
     */
    const fail = (err: Error): void => {
      errored = err
      if (failWaiting) {
        const f = failWaiting
        waiting = null; failWaiting = null
        f(err)
      }
    }

    const reader = {
      read(): Promise<ProxyReadResult> {
        if (queue.length > 0) return Promise.resolve({ done: false, value: queue.shift()! })
        if (errored) return Promise.reject(errored)
        if (ended) return Promise.resolve({ done: true })
        return new Promise<ProxyReadResult>((res, rej) => { waiting = res; failWaiting = rej })
      },
    }

    const response: ProxyResponse = {
      get ok() { return meta?.ok ?? false },
      get status() { return meta?.status ?? 0 },
      body: { getReader: () => reader },
      async text() {
        const parts: Uint8Array[] = []
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) parts.push(value)
        }
        return new TextDecoder().decode(concat(parts))
      },
      async json() {
        return JSON.parse(await this.text())
      },
    }

    const abort = window.electronAPI.ai.stream(
      { url, method: init.method, headers: init.headers, body: init.body },
      {
        onMeta: (m) => {
          meta = m
          if (!settled) { settled = true; resolve(response) }
        },
        onChunk: (c) => pushChunk(c instanceof Uint8Array ? c : new Uint8Array(c)),
        onDone: () => finish(),
        onError: (msg) => {
          const err = new Error(msg)
          if (!settled) { settled = true; errored = err; reject(err) }
          else fail(err)
        },
      }
    )

    /**
     * Stop, from this side.
     *
     * The abort has to settle THIS promise and any pending read, rather than
     * wait for the main process to say something: telling main to abort also
     * removes the listeners that would carry its answer back, so a read left
     * waiting on them would never settle. That is not a leak you can see — the
     * panel looks idle — but the turn's promise never resolves, and anything
     * waiting on it (the guard that stops a message being sent twice) waits
     * for ever.
     */
    const onAbort = (): void => {
      abort()
      const err = new Error('The request was stopped.')
      err.name = 'AbortError'
      if (!settled) { settled = true; errored = err; reject(err) }
      else fail(err)
    }

    if (init.signal) {
      if (init.signal.aborted) onAbort()
      else init.signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}
