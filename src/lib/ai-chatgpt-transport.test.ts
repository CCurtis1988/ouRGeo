import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sendMessage, requiresApiKey, type SendOptions } from '@/lib/ai-client'
import { proxyFetch } from '@/lib/ai-proxy-fetch'

vi.mock('@/lib/ai-proxy-fetch', () => ({ proxyFetch: vi.fn() }))
const fetchMock = vi.mocked(proxyFetch)
const options = (extra: Partial<SendOptions> = {}): SendOptions => ({
  provider: 'openai-subscription', model: 'account-model', apiKey: 'must-not-use',
  messages: [{ id: 'u', role: 'user', content: 'Inspect x', timestamp: 0 }],
  systemPrompt: 'Use the live session.', onChunk: vi.fn(), ...extra,
})
function stream(events: unknown[]) {
  // Split both UTF-8 characters and JSON over arbitrary chunk boundaries.
  const bytes = new TextEncoder().encode(events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join(''))
  let offset = 0
  return {
    ok: true, status: 200, text: vi.fn(), json: vi.fn(),
    body: { getReader: () => ({ read: async () => {
      if (offset >= bytes.length) return { done: true }
      const value = bytes.slice(offset, offset + 7); offset += 7
      return { done: false, value }
    } }) },
  }
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('window', { electronAPI: { chatgpt: { status: async () => ({ activeId: 'registered-account', planEnabled: true }) } } })
})

describe('ChatGPT subscription assistant', () => {
  it('accounts each tool-loop invocation and retains reported usage on an incomplete response', async () => {
    const call = { type: 'function_call', name: 'inspect', namespace: 'ourgeo', call_id: 'usage-call', arguments: '{}' }
    fetchMock.mockResolvedValueOnce(stream([
      { type: 'response.completed', response: { output: [call], usage: { input_tokens: 100, output_tokens: 30, input_tokens_details: { cached_tokens: 80 }, output_tokens_details: { reasoning_tokens: 20 } } } },
    ])).mockResolvedValueOnce(stream([
      { type: 'response.output_text.delta', delta: 'Partial' },
      { type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' }, usage: { input_tokens: 140, output_tokens: 40 } } },
    ]))
    const onInvocationUsage = vi.fn()
    await expect(sendMessage(options({ onInvocationUsage, onToolCall: async () => 'schema', tools: [{ name: 'inspect', description: 'Inspect', inputSchema: { type: 'object', properties: {}, required: [] } }] }))).rejects.toThrow('incomplete')
    expect(onInvocationUsage.mock.calls.map(([report]) => report)).toEqual([
      { invocation: 1, attempt: 0, scope: 'invocation', inputTokens: 100, outputTokens: 30, cachedInputTokens: 80, reasoningTokens: 20, reasoningIncludedInOutput: true, totalTokens: 130 },
      { invocation: 2, attempt: 0, scope: 'invocation', inputTokens: 140, outputTokens: 40, reasoningIncludedInOutput: true, totalTokens: 180 },
    ])
  })
  it('keeps the final text when it arrives in completed items instead of text deltas', async () => {
    const message = { id: 'answer', type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'The result is 42.' }] }
    fetchMock.mockResolvedValue(stream([
      { type: 'response.output_item.done', output_index: 0, item: message },
      { type: 'response.completed', response: { output: null } },
    ]))
    const opts = options()
    expect(await sendMessage(opts)).toBe('The result is 42.')
    expect(opts.onChunk).toHaveBeenCalledWith('The result is 42.')
  })
  it('executes a streamed tool call when the terminal summary does not repeat it', async () => {
    const call = { type: 'function_call', name: 'inspect', namespace: 'ourgeo', call_id: 'call-streamed', arguments: '{"name":"x"}' }
    fetchMock.mockResolvedValueOnce(stream([
      { type: 'response.output_item.done', output_index: 0, item: call },
      { type: 'response.completed', response: { output: [] } },
    ])).mockResolvedValueOnce(stream([
      { type: 'response.output_text.delta', item_id: 'answer', output_index: 0, content_index: 0, delta: 'Four rows.' },
      { type: 'response.completed', response: { output: [] } },
    ]))
    const onToolCall = vi.fn(async () => 'x has four rows')
    expect(await sendMessage(options({ onToolCall, tools: [{ name: 'inspect', description: 'Inspect', inputSchema: { type: 'object', properties: {}, required: [] } }] }))).toBe('Four rows.')
    expect(onToolCall).toHaveBeenCalledWith({ id: 'call-streamed', name: 'inspect', input: { name: 'x' } })
  })
  it('recovers the suffix of a shortened delta stream from the final text without duplicating it', async () => {
    const message = { id: 'answer', type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'The complete answer.' }] }
    fetchMock.mockResolvedValue(stream([
      { type: 'response.output_text.delta', item_id: 'answer', output_index: 0, content_index: 0, delta: 'The complete' },
      { type: 'response.output_text.done', item_id: 'answer', output_index: 0, content_index: 0, text: 'The complete answer.' },
      { type: 'response.output_item.done', output_index: 0, item: message },
      { type: 'response.completed', response: { output: [message] } },
    ]))
    const opts = options()
    expect(await sendMessage(opts)).toBe('The complete answer.')
    expect(vi.mocked(opts.onChunk).mock.calls.map(([chunk]) => chunk).join('')).toBe('The complete answer.')
  })
  it('streams text without an API credential and keeps tool results in stateless history', async () => {
    const call = { type: 'function_call', namespace: 'ourgeo', name: 'inspect', call_id: 'call-1', arguments: '{"name":"x"}' }
    const reasoning = { type: 'reasoning', encrypted_content: 'opaque', summary: [] }
    fetchMock.mockResolvedValueOnce(stream([
      { type: 'response.output_text.delta', delta: 'Checking…' },
      { type: 'response.completed', response: { output: [reasoning, call], usage: { input_tokens: 12 } } },
    ])).mockResolvedValueOnce(stream([
      { type: 'response.output_text.delta', delta: ' Café.' },
      { type: 'response.completed', response: { output: [] } },
    ]))
    const onToolCall = vi.fn(async () => 'x has 4 rows')
    expect(await sendMessage(options({ onToolCall, tools: [{ name: 'inspect', description: 'Inspect data', inputSchema: { type: 'object', properties: {}, required: [] } }] }))).toBe('Checking… Café.')
    expect(requiresApiKey('openai-subscription')).toBe(false)
    expect(onToolCall).toHaveBeenCalledWith({ id: 'call-1', name: 'inspect', input: { name: 'x' } })
    const request = fetchMock.mock.calls[0][1]!
    expect(request).toMatchObject({ billing: 'chatgpt', billingAccountId: 'registered-account' })
    expect(JSON.stringify(request)).not.toContain('must-not-use')
    const body = JSON.parse(request.body!)
    expect(body).toMatchObject({ store: false, stream: true, instructions: 'Use the live session.', tools: [{ type: 'namespace', name: 'ourgeo' }] })
    expect(body).not.toHaveProperty('previous_response_id')
    const next = JSON.parse(fetchMock.mock.calls[1][1]!.body!)
    expect(next.input).toContainEqual(reasoning)
    expect(next.input).toContainEqual({ type: 'function_call_output', call_id: 'call-1', output: 'x has 4 rows' })
  })
  it('reports a subscription limit after streaming and never falls back to API billing', async () => {
    fetchMock.mockResolvedValue(stream([
      { type: 'response.output_text.delta', delta: 'Partial' },
      { type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } },
    ]))
    const opts = options()
    await expect(sendMessage(opts)).rejects.toThrow('ChatGPT Settings → Usage')
    expect(opts.onChunk).toHaveBeenCalledWith('Partial')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('rejects incomplete and interrupted streams without executing pending tools', async () => {
    const onToolCall = vi.fn()
    fetchMock.mockResolvedValueOnce(stream([{ type: 'response.output_text.delta', delta: 'Partial' }]))
    await expect(sendMessage(options({ onToolCall }))).rejects.toThrow('before the response completed')
    fetchMock.mockResolvedValueOnce(stream([{ type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } }]))
    await expect(sendMessage(options({ onToolCall }))).rejects.toThrow('incomplete')
    expect(onToolCall).not.toHaveBeenCalled()
  })
  it('declines tools that were not offered for this turn', async () => {
    fetchMock.mockResolvedValueOnce(stream([{ type: 'response.completed', response: { output: [
      { type: 'function_call', name: 'execute_r_code', call_id: 'disabled', arguments: '{}' },
    ] } }])).mockResolvedValueOnce(stream([{ type: 'response.output_text.delta', delta: 'Tool unavailable.' }, { type: 'response.completed', response: { output: [] } }]))
    const onToolCall = vi.fn()
    await sendMessage(options({ onToolCall, tools: [] }))
    expect(onToolCall).not.toHaveBeenCalled()
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body!).input.at(-1).output).toContain('not enabled')
  })
  it('replays commentary and final answers with their phases on the next user turn', async () => {
    const commentary = { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'Checking. ' }] }
    const answer = { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'Four rows.' }] }
    fetchMock.mockResolvedValueOnce(stream([{ type: 'response.completed', response: { output: [commentary, answer] } }]))
      .mockResolvedValueOnce(stream([{ type: 'response.completed', response: { output: [answer] } }]))
    const onOpenAiMessages = vi.fn()
    const content = await sendMessage(options({ onOpenAiMessages }))
    const parts = onOpenAiMessages.mock.calls[0][0]
    expect(parts).toEqual([{ content: 'Checking. ', phase: 'commentary' }, { content: 'Four rows.', phase: 'final_answer' }])
    await sendMessage(options({ messages: [{ id: 'a', role: 'assistant', content, timestamp: 0, openAiMessages: parts }, { id: 'u2', role: 'user', content: 'And columns?', timestamp: 1 }] }))
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body!).input).toEqual([
      { role: 'assistant', content: 'Checking. ', phase: 'commentary' },
      { role: 'assistant', content: 'Four rows.', phase: 'final_answer' },
      { role: 'user', content: 'And columns?' },
    ])
  })
  it('reports reasoning-only and commentary-only completions instead of silent success', async () => {
    for (const output of [[], [{ type: 'reasoning', encrypted_content: 'opaque' }], [{ type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'Let me check.' }] }]]) {
      fetchMock.mockResolvedValueOnce({ ...stream([{ type: 'response.completed', response: { output } }]), requestId: 'req-test' })
      await expect(sendMessage(options())).rejects.toThrow('without a final answer')
    }
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
  it('reconstructs tool arguments from item and argument events and executes each call once', async () => {
    const call = { id: 'tool-item', type: 'function_call', name: 'inspect', namespace: 'ourgeo', call_id: 'c', arguments: '' }
    fetchMock.mockResolvedValueOnce(stream([
      { type: 'response.output_item.added', output_index: 0, item: call },
      { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"name":' },
      { type: 'response.function_call_arguments.done', output_index: 0, arguments: '{"name":"x"}' },
      { type: 'response.output_item.done', output_index: 0, item: { ...call, arguments: '{"name":"x"}' } },
      { type: 'response.completed', response: { output: [{ ...call, arguments: '{"name":"x"}' }] } },
    ])).mockResolvedValueOnce(stream([{ type: 'response.refusal.done', output_index: 0, content_index: 0, refusal: 'Cannot inspect.' }, { type: 'response.completed', response: { output: [] } }]))
    const onToolCall = vi.fn(async () => 'four')
    expect(await sendMessage(options({ onToolCall, tools: [{ name: 'inspect', description: 'Inspect', inputSchema: { type: 'object', properties: {}, required: [] } }] }))).toBe('Cannot inspect.')
    expect(onToolCall).toHaveBeenCalledTimes(1)
    expect(onToolCall).toHaveBeenCalledWith({ id: 'c', name: 'inspect', input: { name: 'x' } })
  })
  it('stops before a request when the user has declined plan permission', async () => {
    vi.stubGlobal('window', { electronAPI: { chatgpt: { status: async () => ({ activeId: 'account', planEnabled: false }) } } })
    await expect(sendMessage(options())).rejects.toThrow('enable ChatGPT plan usage')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('does not send after Stop is pressed while the account is being checked', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(sendMessage(options({ signal: controller.signal }))).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
