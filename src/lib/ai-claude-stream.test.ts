import { describe, it, expect } from 'vitest'
import { parseClaudeLine, claudeFailureMessage } from './ai-claude-stream'

/**
 * The fixtures are REAL: captured from `claude -p --output-format stream-json`
 * against CLI 2.1.263 while this was written, then trimmed. A hand-invented
 * shape would pass this suite and fail the app.
 */

const init = JSON.stringify({
  type: 'system', subtype: 'init', session_id: 'cffa8aa1-2291-42a1-98d8-b2df89d483f0',
  tools: ['mcp__ourgeo__execute_r_code'],
  mcp_servers: [{ name: 'ourgeo', status: 'connected' }],
  model: 'claude-haiku-4-5-20251001', apiKeySource: 'none',
})

const textDelta = JSON.stringify({
  type: 'stream_event',
  event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'OK' } },
  session_id: 'x',
})

const thinkingDelta = JSON.stringify({
  type: 'stream_event',
  event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } },
})

const signatureDelta = JSON.stringify({
  type: 'stream_event',
  event: { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'Ep..' } },
})

const rateLimit = JSON.stringify({
  type: 'rate_limit_event',
  rate_limit_info: {
    status: 'allowed', rateLimitType: 'five_hour',
    unifiedWindows: {
      five_hour: { utilization: 0.47, resetsAt: 1788850200 },
      seven_day: { utilization: 0.32, resetsAt: 1789344000 },
    },
  },
})

const result = JSON.stringify({
  type: 'result', subtype: 'success', is_error: false, result: 'OK',
  total_cost_usd: 0.00163, num_turns: 1, permission_denials: [],
  usage: { input_tokens: 483, output_tokens: 41, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  modelUsage: { 'claude-haiku-4-5-20251001': { contextWindow: 200000, costUSD: 0.00163 } },
})

describe('reading the CLI’s NDJSON', () => {
  it('takes the session to resume, and notices a bridge that did not connect', () => {
    const ev = parseClaudeLine(init)
    expect(ev).toMatchObject({ kind: 'init', sessionId: 'cffa8aa1-2291-42a1-98d8-b2df89d483f0' })
    const failed = parseClaudeLine(JSON.stringify({
      type: 'system', subtype: 'init', session_id: 's', tools: [],
      mcp_servers: [{ name: 'ourgeo', status: 'failed' }],
    }))
    // Invisible from inside the model — it simply has no tools — so the
    // transport has to see it and say so.
    expect(failed).toMatchObject({ kind: 'init', mcpFailed: ['ourgeo'] })
  })

  it('forwards the answer', () => {
    expect(parseClaudeLine(textDelta)).toEqual({ kind: 'text', text: 'OK' })
  })

  it('never forwards thinking as if it were the answer', () => {
    // Thinking and signature deltas ride the same channel as the text, and a
    // panel that printed them would be showing the model's scratch work.
    expect(parseClaudeLine(thinkingDelta).kind).toBe('ignore')
    expect(parseClaudeLine(signatureDelta).kind).toBe('ignore')
  })

  it('reads the subscription windows, which are the numbers a subscriber plans around', () => {
    expect(parseClaudeLine(rateLimit))
      .toEqual({ kind: 'rateLimit', fiveHour: 0.47, sevenDay: 0.32, resetsAt: 1788850200 })
  })

  it('takes usage and the context window from the run itself', () => {
    // Not from a table of our own: `contextWindow` is reported per model that
    // answered, and a table goes stale the day an alias moves.
    expect(parseClaudeLine(result)).toMatchObject({
      kind: 'result', text: 'OK', isError: false,
      inputTokens: 483, outputTokens: 41, contextWindow: 200000, costUsd: 0.00163,
    })
  })

  it('counts cached input as input', () => {
    const ev = parseClaudeLine(JSON.stringify({
      type: 'result', result: 'x', is_error: false,
      usage: { input_tokens: 10, cache_read_input_tokens: 900, cache_creation_input_tokens: 90, output_tokens: 5 },
      modelUsage: {},
    }))
    expect(ev).toMatchObject({ inputTokens: 1000 })
  })

  it('survives a line that is not JSON at all', () => {
    // The CLI writes the occasional plain warning; the `result` event is what
    // ends a run, so a stray line must not.
    expect(parseClaudeLine('Warning: something').kind).toBe('ignore')
    expect(parseClaudeLine('').kind).toBe('ignore')
  })
})

describe('what the user is told when a run fails', () => {
  it('names the recovery move for a signed-out CLI', () => {
    const m = claudeFailureMessage(1, 'Error: not logged in', false)
    expect(m).toContain('claude auth login')
  })

  it('points at the setting when the binary could not be started', () => {
    expect(claudeFailureMessage(1, 'spawn claude ENOENT', false)).toContain('Settings')
  })

  it('says a usage limit resets, rather than reading as a fault', () => {
    expect(claudeFailureMessage(1, 'usage limit reached', false)).toMatch(/resets/)
  })

  it('does not blame the data when it exited cleanly with nothing', () => {
    expect(claudeFailureMessage(0, '', false)).toContain('Nothing was changed')
  })
})
