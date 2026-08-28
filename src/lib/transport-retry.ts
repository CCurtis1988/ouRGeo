// Requests that die without an HTTP response.
//
// Connection refused or reset; a stale keep-alive socket the R server had
// already closed and Chromium reused; or Chromium aborting every in-flight
// request — localhost included — because the OS suspended or the network
// changed underneath it. Axios reports all of them as the bare message
// "Network Error", which tells neither the user nor the AI assistant anything
// about what to do next.
//
// A retry opens a fresh connection and usually succeeds. A real HTTP error
// carries a `response` and must NOT be retried: it is R's considered answer.
//
// Two paths already knew this — project load and raster registration — each
// with its own copy of the predicate. The vector layer path made three, so it
// lives here.

/**
 * A transport failure that has already been given a human sentence.
 *
 * Once the raw axios error is translated the "Network Error" text is gone, so
 * the class is what lets a caller further up still recognise what happened.
 */
export class TransportError extends Error {
  readonly transport = true
  constructor(message: string) {
    super(message)
    this.name = 'TransportError'
  }
}

/** True when the request failed at the transport level: no HTTP response. */
export function isTransientNetworkError(err: unknown): boolean {
  const e = err as { code?: string; message?: string; response?: unknown } | undefined
  if (!e || e.response) return false
  return e.code === 'ERR_NETWORK' || /network error/i.test(e.message ?? '')
}

/** True for a raw transport failure OR one already translated. */
export function isTransportFailure(err: unknown): boolean {
  return err instanceof TransportError || isTransientNetworkError(err)
}

/** Run `fn`, retrying only connection-severed failures. */
export async function retryOnNetworkError<T>(
  fn: () => Promise<T>,
  { tries = 3, delayMs = 250 }: { tries?: number; delayMs?: number } = {},
): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < tries; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (!isTransientNetworkError(err)) throw err
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  throw lastErr
}

/**
 * A sentence a person can act on, in place of "Network Error".
 *
 * `what` completes "…while <what>", e.g. "reading the geometry of \"buf\"".
 */
export function transportFailureMessage(what: string): string {
  return `the connection to the R server was severed while ${what}, before R answered. ` +
    'This happens when the machine sleeps or the network changes mid-request; it is not a ' +
    'problem with the data. R itself is still running — try again.'
}

/**
 * The same fact, written for the AI assistant.
 *
 * Deliberately prescriptive. A bare "Network Error" gave a local model nothing
 * to go on, and it spent twenty turns rebuilding the user's geometry looking
 * for a fault that was never in the object.
 */
export function transportFailureForModel(action: string, subject?: string): string {
  return `Failed: ${action} could not reach the R server — the connection was severed before R ` +
    'answered (machine sleep, a network change, or a dropped keep-alive socket). This is a ' +
    'transport failure, NOT a problem with the data' +
    (subject ? `: ${subject} is valid and unchanged.` : '.') +
    ' Retry the SAME call once. If it fails again, stop and tell the user the app lost its ' +
    'connection to the R server. Do not simplify geometry, rebuild the object, or try other ' +
    'objects — none of that is related to this failure.'
}
