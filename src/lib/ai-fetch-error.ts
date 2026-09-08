/**
 * Turning a failed AI-provider request into a sentence worth reading.
 *
 * `fetch` reports every transport failure the same way — Node's undici throws
 * `TypeError: fetch failed`, Chromium's stack throws a bare `net::ERR_…` — and
 * that message is what reached the chat panel: **"Error: fetch failed"**, for a
 * server that was not running, a server that never answered, and a connection
 * that dropped halfway through a reply. Three different problems, three
 * different things for the user to do, one useless sentence.
 *
 * The real cause is always there, one level down in `err.cause`, and the host
 * is in the URL we were given. This module puts the two together, and every
 * message names the recovery move — the house rule for an error, and the same
 * argument `transport-retry.ts` makes about axios reporting a severed socket
 * as the string `Network Error`.
 *
 * Pure, and listed in `tsconfig.node.json` so the main process can import it:
 * the failure is caught there, and a builder exercised only by launching
 * Electron is one nobody exercises. Same pattern as `ai-claude-args.ts`.
 */

/** What `fetch` throws, as much of it as is worth reading. */
export interface FetchFailure {
  message?: string
  code?: string
  cause?: unknown
}

/** The `host:port` a user would recognise, or the whole URL if it will not parse. */
export function hostOf(url: string): string {
  try {
    const u = new URL(url)
    return u.port ? `${u.hostname}:${u.port}` : u.hostname
  } catch {
    return url
  }
}

/**
 * Is this the user's own machine?
 *
 * The proxy is provider-agnostic — it is handed a URL, not a provider — and
 * this is the one distinction the message needs: a local server is a process
 * the user can go and look at, so the advice is different, and it is exactly
 * the boundary `ai-web-tools.ts` already refuses to cross.
 */
export function isLoopbackHost(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '')
    return h === 'localhost' || h === '::1' || h.endsWith('.localhost')
      || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  } catch {
    return false
  }
}

/**
 * Flatten the cause chain into one lower-case haystack.
 *
 * A chain rather than one level: undici nests `TypeError: fetch failed` →
 * `Error: connect ECONNREFUSED 127.0.0.1:8080`, and a self-signed certificate
 * goes one deeper still.
 */
function chain(err: unknown, depth = 0): { text: string; codes: string[] } {
  if (!err || depth > 5) return { text: '', codes: [] }
  if (typeof err === 'string') return { text: err, codes: [] }
  const e = err as FetchFailure
  const inner = chain(e.cause, depth + 1)
  return {
    text: [e.message ?? '', inner.text].filter(Boolean).join(' | '),
    codes: [...(e.code ? [e.code] : []), ...inner.codes],
  }
}

/**
 * A sentence for a failed provider request.
 *
 * `local` decides who is being blamed: a local server is the user's own
 * process and they can go and look at it, while a cloud endpoint failing to
 * resolve is a network problem on this machine.
 */
export function describeFetchFailure(url: string, err: unknown, local = false): string {
  const { text, codes } = chain(err)
  const hay = `${codes.join(' ')} ${text}`.toLowerCase()
  const where = hostOf(url)
  const has = (...needles: string[]): boolean => needles.some((n) => hay.includes(n))

  if (has('econnrefused', 'err_connection_refused')) {
    return local
      ? `Nothing is listening at ${where}. Start the server, or correct its address in Settings → AI Assistant.`
      : `The connection to ${where} was refused.`
  }
  if (has('enotfound', 'eai_again', 'err_name_not_resolved', 'getaddrinfo')) {
    return `The address ${where} could not be resolved. Check the URL, and that this machine is online.`
  }
  if (has('headers_timeout', 'err_timed_out', 'etimedout')) {
    return `${where} accepted the request but sent nothing back before the connection timed out. `
      + (local
        ? 'A local model loading or working through a long prompt can take longer than that — give it a smaller prompt, or wait for it to finish the request it is already on.'
        : 'Try again; if it keeps happening the service is not answering.')
  }
  if (has('body_timeout')) {
    return `${where} stopped sending part-way through the answer and the connection timed out. `
      + 'Whatever had arrived is kept above.'
  }
  if (has('connect_timeout')) {
    return `Timed out trying to reach ${where}. Check the address and that the server is up.`
  }
  // `ERR_INCOMPLETE_CHUNKED_ENCODING` is what Chromium calls a streamed answer
  // whose connection went away before the last chunk — the ordinary way a
  // local server dies mid-sentence, and the case this whole module exists for.
  if (has('econnreset', 'socket hang up', 'other side closed', 'epipe',
          'err_connection_reset', 'err_connection_closed', 'err_connection_aborted',
          'err_incomplete_chunked_encoding', 'err_empty_response', 'err_socket_not_connected')) {
    return `The connection to ${where} dropped before the reply finished. `
      + (local
        ? 'A local server that ran out of memory usually ends this way — its own log will say.'
        : 'Try again.')
  }
  if (has('self-signed', 'self signed', 'cert_', 'err_cert', 'unable to verify')) {
    return `${where} presented a certificate this machine does not trust.`
  }
  if (has('abort')) return 'The request was stopped.'

  // Nothing recognised: say what happened and where, which still beats
  // "fetch failed" on its own.
  const detail = [codes[0], text].filter(Boolean).join(': ').slice(0, 300)
  return `The request to ${where} failed${detail ? ` — ${detail}` : ''}.`
}
