import { beforeEach, expect, it, vi } from 'vitest'
import { sendMessage, type SendOptions } from './ai-client'
import { proxyFetch } from './ai-proxy-fetch'
import { totalUsage, updateUsage, type UsageReport } from './context/usage'

vi.mock('./ai-proxy-fetch', () => ({ proxyFetch: vi.fn() }))
const fetchMock = vi.mocked(proxyFetch)
const options = (extra: Partial<SendOptions>): SendOptions => ({ provider: 'anthropic', model: 'fixture', apiKey: '', contextSize: 32000, systemPrompt: 'Use evidence.', messages: [{ id: 'u', role: 'user', content: 'Inspect roads', timestamp: 0 }], onChunk: vi.fn(), ...extra })
function stream(events: unknown[]) {
  const bytes = new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''))
  let done = false
  return { ok: true, status: 200, text: vi.fn(), json: vi.fn(), body: { getReader: () => ({ read: async () => { if (done) return { done: true }; done = true; return { done: false, value: bytes } } }) } }
}
beforeEach(() => vi.resetAllMocks())

it('counts Anthropic cached input and cumulative output once per call without adding old output to occupancy', async () => {
  fetchMock.mockResolvedValueOnce(stream([
    { type: 'message_start', message: { usage: { input_tokens: 10, cache_read_input_tokens: 80, cache_creation_input_tokens: 10, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool', name: 'inspect' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } },
  ])).mockResolvedValueOnce(stream([
    { type: 'message_start', message: { usage: { input_tokens: 40, cache_read_input_tokens: 100, output_tokens: 0 } } },
    { type: 'message_delta', usage: { output_tokens: 10 } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 30 } },
  ]))
  let reports: UsageReport[] = []
  const onUsage = vi.fn()
  await sendMessage(options({ onUsage, onInvocationUsage: report => { reports = updateUsage(reports, report) }, onToolCall: async () => 'schema', tools: [{ name: 'inspect', description: 'Inspect', inputSchema: { type: 'object', properties: {}, required: [] } }] }))
  expect(reports).toHaveLength(2)
  expect(totalUsage(reports)).toMatchObject({ input: 240, output: 50, cached: 180 })
  expect(onUsage).toHaveBeenLastCalledWith(170, 32000)
})

it('retains partial local usage and refuses failed HTTP responses before executing tools', async () => {
  fetchMock.mockResolvedValueOnce({ ...stream([]), json: async () => ({ message: { content: 'Schema' }, prompt_eval_count: 120 }) })
  const onInvocationUsage = vi.fn(), onToolCall = vi.fn(async () => 'schema')
  const opts = options({ provider: 'ollama', onInvocationUsage, onToolCall, tools: [{ name: 'inspect', description: 'Inspect', inputSchema: { type: 'object', properties: {}, required: [] } }] })
  expect(await sendMessage(opts)).toBe('Schema')
  expect(onInvocationUsage).toHaveBeenCalledWith({ invocation: 1, attempt: 0, scope: 'invocation', inputTokens: 120 })
  fetchMock.mockResolvedValueOnce({ ...stream([]), ok: false, status: 500, json: async () => ({ message: { tool_calls: [{ function: { name: 'inspect', arguments: {} } }] } }) })
  await expect(sendMessage(opts)).rejects.toThrow('HTTP 500')
  expect(onToolCall).not.toHaveBeenCalled()
})
