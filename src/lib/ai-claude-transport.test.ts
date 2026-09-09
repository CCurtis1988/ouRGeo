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
interface Run { lines: string[]; code?: number; stderr?: string }

/**
 * Stand in for the CLI: capture what it was asked to run, then replay lines.
 *
 * Takes a LIST of runs so a test can script the retry — the second element is
 * what the second spawn produces.
 */
function fakeCli(...runs: Run[]): { started: Started[] } {
  const started: Started[] = []
  const api = {
    start(
      req: Started,
      handlers: { onLine: (l: string) => void; onDone: (code: number, err: string) => void },
    ) {
      const run = runs[Math.min(started.length, runs.length - 1)]
      started.push(req)
      queueMicrotask(() => {
        for (const l of run.lines) handlers.onLine(l)
        handlers.onDone(run.code ?? 0, run.stderr ?? '')
      })
      return () => {}
    },
  }
  ;(window as unknown as { electronAPI: unknown }).electronAPI = { claudeCli: api }
  return { started }
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
    // The window comes from the run's own report, once it has made one.
    expect(seen[seen.length - 1].total).toBe(1_000_000)
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
      claudeResume: true, claudeSessionId: 'sid-1',
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
      claudeResume: true, claudeSessionId: 'sid-1',
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
      claudeSessionId: 'sid-from-another-machine', claudeResume: true,
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
      claudeSessionId: 'dead', claudeResume: true,
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
      claudeSessionId: 'sid-1', claudeResume: true,
      onChunk: () => {},
    })).rejects.toThrow(/invalid API response/)
    expect(started).toHaveLength(1)
  })
})
