// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sendMessage } from './ai-client'
import type { ChatMessage } from '@/store/ai'

interface Started {
  prompt: string
  systemPrompt: string
  resume: boolean
  sessionId: string
}

/** One scripted CLI run: the lines it emits, then how it exits. */
interface Run { lines: string[]; code?: number; stderr?: string; calls?: { name: string; input: Record<string, unknown> }[] }

/**
 * Stand in for the CLI: capture what it was asked to run, then replay lines.
 *
 * Takes a LIST of runs so a test can script the retry — the second element is
 * what the second spawn produces.
 */
function fakeCli(...runs: Run[]): { started: Started[]; results: string[] } {
  const started: Started[] = []
  const results: string[] = []
  const api = {
    start(
      req: Started,
      handlers: { onLine: (l: string) => void; onDone: (code: number, err: string) => void; onToolCall: (call: { name: string; input: Record<string, unknown> }) => Promise<string> },
    ) {
      const run = runs[Math.min(started.length, runs.length - 1)]
      started.push(req)
      queueMicrotask(async () => {
        for (const l of run.lines) handlers.onLine(l)
        for (const call of run.calls ?? []) results.push(await handlers.onToolCall(call))
        handlers.onDone(run.code ?? 0, run.stderr ?? '')
      })
      return () => {}
    },
  }
  ;(window as unknown as { electronAPI: unknown }).electronAPI = { claudeCli: api }
  return { started, results }
}

const msg = (role: 'user' | 'assistant', content: string): ChatMessage =>
  ({ id: content, role, content, timestamp: 0 })

const line = (o: unknown): string => JSON.stringify(o)

const INIT = line({ type: 'system', subtype: 'init', session_id: 'sid-1', tools: [], mcp_servers: [] })
/** What the CLI actually emits for a session it does not have — captured from
 *  a real run of 2.1.263 against an unknown uuid. */
const GONE = line({
  type: 'result', subtype: 'error_during_execution', is_error: true,
  session_id: 'dead', usage: {}, modelUsage: {},
})
const GONE_STDERR = 'No conversation found with session ID: 137dfee0-9429-4de9-9e7c-2b5f566fc01c'
const usage = (input: number, read: number, out: number): string => line({
  type: 'stream_event',
  event: { type: 'message_start', message: { usage: {
    input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: 0, output_tokens: out,
  } } },
})
const text = (t: string): string => line({
  type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: t } },
})
const RESULT = line({
  type: 'result', result: 'done', is_error: false,
  usage: { input_tokens: 9999, cache_read_input_tokens: 9999, cache_creation_input_tokens: 9999, output_tokens: 9999 },
  modelUsage: { 'claude-sonnet-5': { contextWindow: 1_000_000 } },
})

beforeEach(() => { delete (window as unknown as { electronAPI?: unknown }).electronAPI })

describe('what the context bar is told', () => {
  it('follows each API call while the run is going, and never adds them up', async () => {
    // Two calls, as an autopilot turn makes: the second re-sends the first as
    // a cache read. The window is holding ~7k, not the ~14k the result event's
    // cumulative figures would suggest.
    fakeCli({ lines: [INIT, usage(2, 0, 4), text('one moment'), usage(2, 6680, 8), text('…done'), RESULT] })
    const seen: { used: number; total: number }[] = []

    await sendMessage({
      provider: 'claude-cli', model: 'sonnet', apiKey: '',
      messages: [msg('user', 'hi')], systemPrompt: 'S',
      onChunk: () => {}, onUsage: (used, total) => seen.push({ used, total }),
    })

    expect(seen.map((s) => s.used)).toEqual([6, 6690, 6690])
    // A reported larger window cannot raise the configured conservative limit.
    expect(seen[seen.length - 1].total).toBe(200_000)
    expect(seen[0].total).toBe(200_000)
  })
})

describe('where the session context rides', () => {
  it('goes with the turn, never into the system prompt', async () => {
    // The system prompt must be byte-identical from one turn to the next or
    // Claude Code's cached prefix is thrown away and the whole conversation is
    // re-charged as a cache write — measured at 16× on a two-turn chat.
    const { started } = fakeCli({ lines: [INIT, text('ok'), RESULT] })

    await sendMessage({
      provider: 'claude-cli', model: 'sonnet', apiKey: '',
      messages: [msg('user', 'how many rows?')],
      systemPrompt: 'STABLE RULES',
      sessionContext: '# Session state at this turn\nObjects: pts',
      claudeResume: true, claudeContextUsed: 1000, claudeSessionId: 'sid-1',
      onChunk: () => {},
    })

    expect(started[0].systemPrompt).toBe('STABLE RULES')
    expect(started[0].prompt).toContain('Objects: pts')
    expect(started[0].prompt.endsWith('how many rows?')).toBe(true)
  })

  it('sends the turn alone when there is no context to carry', async () => {
    const { started } = fakeCli({ lines: [INIT, text('ok'), RESULT] })
    await sendMessage({
      provider: 'claude-cli', model: 'sonnet', apiKey: '',
      messages: [msg('user', 'hello')], systemPrompt: 'S',
      claudeResume: true, claudeContextUsed: 1000, claudeSessionId: 'sid-1',
      onChunk: () => {},
    })
    expect(started[0].prompt).toBe('hello')
  })
})

describe('a run that goes wrong', () => {
  it('rejects rather than resolving with a half answer', async () => {
    const spy = vi.fn()
    fakeCli({ lines: [INIT, text('I was saying')] })
    await expect(sendMessage({
      provider: 'claude-cli', model: 'sonnet', apiKey: '',
      messages: [msg('user', 'hi')], systemPrompt: 'S', onChunk: spy,
    })).rejects.toThrow(/without answering/)
    // …and the caller keeps what it streamed: onChunk already delivered it.
    expect(spy).toHaveBeenCalledWith('I was saying')
  })
})

describe('retained transcript reconstruction', () => {
  const options = () => ({ provider: 'claude-cli' as const, model: 'sonnet', apiKey: '',
    messages: [msg('user', 'Use metres exactly.'), msg('assistant', 'Acknowledged.'), msg('user', 'Continue.')],
    systemPrompt: 'S', contextSize: 10000, maxOutputTokens: 1000,
    claudeResume: true, claudeSessionId: 'prior', onChunk: vi.fn() })

  it('reconstructs unknown occupancy rather than trusting an imported session id', async () => {
    const { started } = fakeCli({ lines: [INIT, usage(1000, 0, 2), RESULT] })
    const lost = vi.fn(), confirmed = vi.fn()
    await sendMessage({ ...options(), onClaudeSessionLost: lost, onClaudeSession: confirmed })
    expect(started[0].resume).toBe(false)
    expect(started[0].sessionId).not.toBe('prior')
    expect(started[0].prompt).toContain('Use metres exactly.')
    expect(lost).toHaveBeenCalledOnce()
    expect(confirmed).toHaveBeenCalledWith('sid-1')
  })

  it('counts pending evidence and output reservation before deciding to resume', async () => {
    const { started } = fakeCli({ lines: [INIT, usage(1000, 0, 2), RESULT] })
    await sendMessage({ ...options(), claudeContextUsed: 5100, sessionContext: 'evidence '.repeat(200) })
    expect(started[0].resume).toBe(false)
    expect(started[0].prompt).toContain('Use metres exactly.')
  })

  it('never acknowledges a failed run merely because init identified a session', async () => {
    fakeCli({ lines: [INIT, usage(1000, 0, 2)], code: 1, stderr: 'failed' })
    const confirmed = vi.fn(), lost = vi.fn()
    await expect(sendMessage({ ...options(), claudeContextUsed: 1000, onClaudeSession: confirmed, onClaudeSessionLost: lost })).rejects.toThrow('failed')
    expect(confirmed).not.toHaveBeenCalled()
    expect(lost).toHaveBeenCalledOnce()
  })

  it('drops retained evidence after upstream compaction without ingesting its summary', async () => {
    fakeCli({ lines: [INIT, usage(1000, 0, 2), line({ type: 'system', subtype: 'compact_boundary', content: 'private summary' }), RESULT] })
    const confirmed = vi.fn(), lost = vi.fn(), chunk = vi.fn()
    await sendMessage({ ...options(), claudeContextUsed: 1000, onClaudeSession: confirmed, onClaudeSessionLost: lost, onChunk: chunk })
    expect(confirmed).not.toHaveBeenCalled()
    expect(lost).toHaveBeenCalledOnce()
    expect(chunk).not.toHaveBeenCalled()
  })

  it('does not infer occupancy from cumulative run totals when per-call usage is missing', async () => {
    fakeCli({ lines: [INIT, RESULT] })
    const confirmed = vi.fn(), lost = vi.fn()
    await sendMessage({ ...options(), claudeContextUsed: 1000, onClaudeSession: confirmed, onClaudeSessionLost: lost })
    expect(confirmed).not.toHaveBeenCalled()
    expect(lost).toHaveBeenCalledOnce()
  })

  it('refuses another tool before execution when observed occupancy leaves no safe result space', async () => {
    const { results } = fakeCli({ lines: [INIT, usage(7990, 0, 2), RESULT], calls: [{ name: 'read', input: {} }] })
    const run = vi.fn(async () => 'content')
    await sendMessage({ ...options(), claudeContextUsed: 1000, onToolCall: run })
    expect(run).not.toHaveBeenCalled()
    expect(results[0]).toContain('BUDGET_LIMIT')
  })

  it('archives oversized tool output and counts it before a subsequent unobserved call', async () => {
    const { results } = fakeCli({ lines: [INIT, usage(7000, 0, 2), RESULT], calls: [{ name: 'read', input: {} }, { name: 'read', input: {} }] })
    const raw = 'large source '.repeat(2000)
    const archived = vi.fn(() => JSON.stringify({ ref: 'ctx_result', complete: false }))
    const run = vi.fn(async () => raw)
    await sendMessage({ ...options(), claudeContextUsed: 1000, onToolCall: run, archiveToolResult: archived })
    expect(archived).toHaveBeenCalledWith(raw)
    expect(results.every(result => result.includes('ctx_result'))).toBe(true)
    expect(results.join('')).not.toContain('large source')
  })
})

describe('a stored session the CLI no longer has', () => {
  it('replays the turn as a NEW session instead of failing for good', async () => {
    // The portability case, and the reason `messages` is the record while
    // `claudeSessionId` is only a cache: a .ourgeoproj opened on another
    // machine names transcripts that machine has never seen. Left alone the
    // dead id is stored, so every retry fails identically and the
    // conversation can never be continued again.
    const { started } = fakeCli(
      { lines: [GONE], code: 1, stderr: GONE_STDERR },
      { lines: [INIT, text('carrying on'), RESULT] },
    )
    const lost = vi.fn()

    const answer = await sendMessage({
      provider: 'claude-cli', model: 'sonnet', apiKey: '',
      messages: [
        msg('user', 'how many rows?'), msg('assistant', '7'), msg('user', 'times six?'),
      ],
      systemPrompt: 'S',
      claudeSessionId: 'sid-from-another-machine', claudeResume: true, claudeContextUsed: 1000,
      onChunk: () => {}, onClaudeSessionLost: lost,
    })

    expect(answer).toBe('done')
    expect(started).toHaveLength(2)
    expect(started[0].resume).toBe(true)
    // The retry is a NEW session, not the dead one over again.
    expect(started[1].resume).toBe(false)
    expect(started[1].sessionId).not.toBe('sid-from-another-machine')
    // …and it carries the conversation, or the model would answer a follow-up
    // having forgotten the question it follows.
    expect(started[1].prompt).toContain('how many rows?')
    expect(started[1].prompt.endsWith('times six?')).toBe(true)
    expect(lost).toHaveBeenCalled()
  })

  it('retries once, not for ever', async () => {
    const { started } = fakeCli({ lines: [GONE], code: 1, stderr: GONE_STDERR })
    await expect(sendMessage({
      provider: 'claude-cli', model: 'sonnet', apiKey: '',
      messages: [msg('user', 'hi')], systemPrompt: 'S',
      claudeSessionId: 'dead', claudeResume: true, claudeContextUsed: 1000,
      onChunk: () => {},
    })).rejects.toThrow()
    // The second attempt is not a resume, so a second "no conversation" is a
    // real failure and must surface rather than loop.
    expect(started).toHaveLength(2)
  })

  it('does not mistake an ordinary failure for a cold cache', async () => {
    const { started } = fakeCli({ lines: [], code: 1, stderr: 'Error: invalid API response' })
    await expect(sendMessage({
      provider: 'claude-cli', model: 'sonnet', apiKey: '',
      messages: [msg('user', 'hi')], systemPrompt: 'S',
      claudeSessionId: 'sid-1', claudeResume: true, claudeContextUsed: 1000,
      onChunk: () => {},
    })).rejects.toThrow(/invalid API response/)
    expect(started).toHaveLength(1)
  })
})
