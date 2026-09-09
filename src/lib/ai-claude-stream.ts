/**
 * Reading one line of `claude -p --output-format stream-json`.
 *
 * The CLI's NDJSON wraps, among other things, the **verbatim Anthropic
 * Messages streaming events** — `content_block_delta` with a `text_delta` is
 * the same object `sendAnthropic` already parses off the wire. So this module
 * is a demultiplexer, not a second protocol implementation.
 *
 * Pure and line-at-a-time so it can be tested against captured output with no
 * child process. The captures in the test are real: they were taken from runs
 * against CLI 2.1.263 while this was being written.
 */

export type ClaudeEvent =
  /** The run has started: the session to resume next turn, and whether our
   *  MCP server actually connected (a `failed` here is why no tool works). */
  | { kind: 'init'; sessionId: string; tools: string[]; mcpFailed: string[] }
  /** A token of the answer. THINKING deltas never arrive here — they come on
   *  the same channel and are not the answer. */
  | { kind: 'text'; text: string }
  /**
   * How full the context window is RIGHT NOW, read off one API call's own
   * `message_start` / `message_delta`.
   *
   * This is the only honest source for the context bar, and the reason is
   * measured: a run's `result.usage` is the SUM over every API call the agent
   * loop made. A two-call run reported in=4 read=6680 create=6862 — 13,546
   * "input tokens" — while the context actually sent on the second call was
   * 2 + 6680 + 182 = 6,864. The sum grows with the number of tool calls, not
   * with the conversation, so a long autopilot turn reported several times the
   * window it was using and the bar pegged at 100%.
   *
   * `contextTokens` is 0 when a delta carried no input counts; the caller keeps
   * the last number it saw. `outputTokens` is cumulative for the current call.
   */
  | { kind: 'usage'; contextTokens: number; outputTokens: number }
  /** How much of the subscription window this run has used. For a subscriber
   *  this is the number worth showing; tokens are the API's unit, not theirs. */
  | { kind: 'rateLimit'; fiveHour: number; sevenDay: number; resetsAt: number }
  /** The run is over. `text` is the final answer as the CLI assembled it. */
  | {
      kind: 'result'
      text: string
      isError: boolean
      /** The CLI's own word for how the run ended. `error_during_execution` is
       *  what a `--resume` of a session this machine does not have produces —
       *  see `isMissingSession`. */
      subtype: string
      /** Tokens BILLED across every API call this run made — cumulative, and
       *  therefore not the context window's occupancy. See `usage`. */
      inputTokens: number
      outputTokens: number
      contextWindow: number | null
      costUsd: number | null
      deniedTools: string[]
      errorStatus: string | null
    }
  | { kind: 'ignore' }

interface Json { [k: string]: unknown }

const obj = (v: unknown): Json | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * Everything the model was sent on one API call.
 *
 * Cached tokens are still context — they occupy the window exactly as fresh
 * ones do; caching changes what they cost, not what they take up. A prompt of
 * which 6,680 tokens were a cache hit is a 6,680-token prompt.
 */
function promptTokens(u: Json): number {
  return num(u.input_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens)
}

export function parseClaudeLine(line: string): ClaudeEvent {
  let msg: Json | null
  try {
    msg = obj(JSON.parse(line))
  } catch {
    // The CLI writes the occasional non-JSON line (a warning, a stray notice).
    // Dropping it is right: the `result` event is what ends a run.
    return { kind: 'ignore' }
  }
  if (!msg) return { kind: 'ignore' }

  if (msg.type === 'system' && msg.subtype === 'init') {
    const servers = Array.isArray(msg.mcp_servers) ? msg.mcp_servers : []
    return {
      kind: 'init',
      sessionId: str(msg.session_id),
      tools: Array.isArray(msg.tools) ? msg.tools.filter((t): t is string => typeof t === 'string') : [],
      mcpFailed: servers
        .map((s) => obj(s))
        .filter((s): s is Json => !!s && s.status !== 'connected')
        .map((s) => str(s.name)),
    }
  }

  if (msg.type === 'stream_event') {
    const ev = obj(msg.event)
    if (!ev) return { kind: 'ignore' }

    // Both of these carry this ONE call's usage, and both arrive while the run
    // is still going — which is what makes the context bar live rather than a
    // number that appears once the answer has finished.
    if (ev.type === 'message_start') {
      const u = obj(obj(ev.message)?.usage)
      if (u) return { kind: 'usage', contextTokens: promptTokens(u), outputTokens: num(u.output_tokens) }
      return { kind: 'ignore' }
    }
    if (ev.type === 'message_delta') {
      const u = obj(ev.usage)
      if (u) return { kind: 'usage', contextTokens: promptTokens(u), outputTokens: num(u.output_tokens) }
      return { kind: 'ignore' }
    }

    if (ev.type !== 'content_block_delta') return { kind: 'ignore' }
    const delta = obj(ev.delta)
    // `thinking_delta` and `signature_delta` ride the same channel. Neither is
    // the answer, and forwarding either would print the model's scratch work
    // into the chat panel.
    if (!delta || delta.type !== 'text_delta') return { kind: 'ignore' }
    return { kind: 'text', text: str(delta.text) }
  }

  if (msg.type === 'rate_limit_event') {
    const info = obj(msg.rate_limit_info)
    const windows = info ? obj(info.unifiedWindows) : null
    const five = windows ? obj(windows.five_hour) : null
    const seven = windows ? obj(windows.seven_day) : null
    return {
      kind: 'rateLimit',
      fiveHour: num(five?.utilization),
      sevenDay: num(seven?.utilization),
      resetsAt: num(five?.resetsAt),
    }
  }

  if (msg.type === 'result') {
    const usage = obj(msg.usage)
    const models = obj(msg.modelUsage)
    // `contextWindow` is reported per model that answered, which beats a table
    // of our own that goes stale the day an alias moves.
    const first = models ? obj(Object.values(models)[0]) : null
    const denials = Array.isArray(msg.permission_denials) ? msg.permission_denials : []
    return {
      kind: 'result',
      text: str(msg.result),
      isError: msg.is_error === true,
      subtype: str(msg.subtype),
      inputTokens: num(usage?.input_tokens) + num(usage?.cache_read_input_tokens)
        + num(usage?.cache_creation_input_tokens),
      outputTokens: num(usage?.output_tokens),
      contextWindow: first && typeof first.contextWindow === 'number' ? first.contextWindow : null,
      costUsd: typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : null,
      deniedTools: denials
        .map((d) => obj(d))
        .map((d) => str(d?.tool_name))
        .filter(Boolean),
      errorStatus: typeof msg.api_error_status === 'string' ? msg.api_error_status : null,
    }
  }

  return { kind: 'ignore' }
}

/**
 * Did this run fail because the CLI has never heard of the session?
 *
 * A chat's `claudeSessionId` is a cache, not the record, and the cache can be
 * cold for entirely ordinary reasons: a `.ourgeoproj` opened on another
 * machine, a cleared `~/.claude`, a transcript the user pruned. Measured
 * against CLI 2.1.263:
 *
 *     $ claude --resume <unknown-uuid> …
 *     exit=1
 *     stderr: No conversation found with session ID: 137dfee0-…
 *     stdout: {"type":"result","subtype":"error_during_execution",…}
 *
 * Left alone this is unrecoverable rather than merely broken — the dead id is
 * stored, so every retry fails identically and the conversation can never be
 * continued again. The caller answers it by starting a fresh session from
 * ouRGeo's own messages, which is why they are the record.
 */
export function isMissingSession(stderr: string, resultSubtype: string | null): boolean {
  if (/no conversation found/i.test(stderr)) return true
  // The message can be absent when stderr was consumed elsewhere; the subtype
  // is the same run's own account of itself.
  return resultSubtype === 'error_during_execution' && /session id/i.test(stderr)
}

/**
 * What to tell the user when a run ends badly.
 *
 * The CLI's own message is often a sentence about a flag or a session, which
 * is not what went wrong from where the user is sitting. Each of these names
 * the recovery move, which is the house rule for an error message.
 */
export function claudeFailureMessage(
  exitCode: number | null, stderr: string, sawResult: boolean
): string {
  const tail = stderr.trim().split('\n').slice(-3).join(' ').slice(0, 400)
  if (/not logged in|authentication|unauthorized|please run .*login/i.test(stderr)) {
    return 'Claude Code is not signed in. Run `claude auth login` in the terminal panel, then try again.'
  }
  if (/ENOENT/i.test(stderr)) {
    return 'The Claude Code CLI could not be started. Check the path in Settings → AI Assistant.'
  }
  if (/rate limit|usage limit/i.test(stderr)) {
    return 'Your Claude subscription has hit its usage limit for this window. The limit resets on its own; Settings → AI Assistant shows when.'
  }
  if (!sawResult && exitCode === 0) {
    return 'Claude Code exited without answering. Nothing was changed.'
  }
  return `Claude Code exited with code ${exitCode ?? 'unknown'}${tail ? `: ${tail}` : '.'}`
}
