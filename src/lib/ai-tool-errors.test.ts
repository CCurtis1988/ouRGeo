import { beforeEach, expect, it, vi } from 'vitest'
import { sendMessage, type SendOptions } from './ai-client'
import { proxyFetch } from './ai-proxy-fetch'
vi.mock('./ai-proxy-fetch', () => ({ proxyFetch: vi.fn() }))
const fetchMock = vi.mocked(proxyFetch)

function stream(events: unknown[]) {
  const bytes = new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''))
  let done = false
  return { ok: true, status: 200, text: vi.fn(), json: vi.fn(), body: { getReader: () => ({ read: async () => { if (done) return { done: true, value: undefined }; done = true; return { done: false, value: bytes } }, cancel: async () => undefined, releaseLock: () => undefined }) } } as never
}
const toolTurn = () => stream([
  { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call', name: 'context_search' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
])
const answer = () => stream([
  { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Answer from what I have.' } },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
])
const options = (onToolCall: SendOptions['onToolCall'], extra: Partial<SendOptions> = {}): SendOptions => ({
  provider: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'test', contextSize: 32000, messages: [{ id: 'm', role: 'user', content: 'Hi', timestamp: 0 }],
  systemPrompt: '', onChunk: () => undefined, tools: [{ name: 'context_search', description: 'd', inputSchema: { type: 'object', properties: {} } }], onToolCall, ...extra,
}) as SendOptions
const toolResult = () => JSON.parse(fetchMock.mock.calls[1][1]!.body!).messages.at(-1).content[0]

beforeEach(() => { vi.resetAllMocks() })

it('hands a refused tool call back to the model, which still answers', async () => {
  fetchMock.mockResolvedValueOnce(toolTurn()).mockResolvedValueOnce(answer())
  const refuse = vi.fn(async () => { throw new Error('BUDGET_LIMIT: this turn has used its 6 context lookups.') })
  await expect(sendMessage(options(refuse))).resolves.toContain('Answer from what I have.')
  expect(toolResult().content).toBe('Error: Error: BUDGET_LIMIT: this turn has used its 6 context lookups.')
})

it('redacts the refusal it hands back', async () => {
  fetchMock.mockResolvedValueOnce(toolTurn()).mockResolvedValueOnce(answer())
  await sendMessage(options(async () => { throw new Error('failed with api_key=sk-ant-abcdefghijklmnopqrstuvwxyz') }))
  expect(toolResult().content).not.toContain('sk-ant-abcdefghijklmnopqrstuvwxyz')
})

it('still ends the turn when the workspace changed under it', async () => {
  fetchMock.mockResolvedValueOnce(toolTurn())
  await expect(sendMessage(options(async () => { throw new Error('SCOPE_CHANGED') }))).rejects.toThrow('SCOPE_CHANGED')
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it('still ends the turn when the user cancelled', async () => {
  const controller = new AbortController()
  fetchMock.mockResolvedValueOnce(toolTurn())
  const stopped = options(async () => { controller.abort(); throw new Error('Tool interrupted') }, { signal: controller.signal })
  await expect(sendMessage(stopped)).rejects.toThrow()
  expect(fetchMock).toHaveBeenCalledTimes(1)
})
