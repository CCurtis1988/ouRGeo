import { beforeEach, expect, it, vi } from 'vitest'
import { sendMessage, type SendOptions } from './ai-client'
import { thinkingCapability, ollamaThinkingCapability } from './ai-thinking'
import { proxyFetch } from './ai-proxy-fetch'
import { buildClaudeArgs, type ClaudeRunSpec } from './ai-claude-args'
vi.mock('./ai-proxy-fetch', () => ({ proxyFetch: vi.fn() }))
const fetchMock = vi.mocked(proxyFetch)
const opts = (extra: Partial<SendOptions>): SendOptions => ({ provider: 'openai', model: 'o3', apiKey: 'test', contextSize: 32000, messages: [{ id: 'u', role: 'user', content: 'Hello', timestamp: 0 }], systemPrompt: 'Help.', onChunk: vi.fn(), ...extra })
function stream(events: unknown[]) {
  const bytes = new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''))
  let done = false
  return { ok: true, status: 200, text: vi.fn(), json: vi.fn(), body: { getReader: () => ({ read: async () => { if (done) return { done: true }; done = true; return { done: false, value: bytes } } }) } }
}
const body = (index = 0) => JSON.parse(fetchMock.mock.calls[index][1]!.body!)
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('window', { electronAPI: { chatgpt: { status: async () => ({ activeId: 'test', planEnabled: true }) } } }) })
it('sends effort to Chat Completions and Responses while omitting provider defaults', async () => {
  fetchMock.mockResolvedValue(stream([{ choices: [{ delta: { content: 'Hello' }, finish_reason: 'stop' }] }]))
  await sendMessage(opts({ thinking: { capability: thinkingCapability('openai', 'o3')!, value: 'high' } }))
  expect(body().reasoning_effort).toBe('high')
  await sendMessage(opts({ thinking: { capability: thinkingCapability('openai', 'o3')!, value: 'default' } }))
  expect(body(1)).not.toHaveProperty('reasoning_effort')
  fetchMock.mockResolvedValue(stream([{ type: 'response.output_text.delta', delta: 'Hello' }, { type: 'response.completed', response: { output: [] } }]))
  await sendMessage(opts({ provider: 'openai-subscription', thinking: { capability: thinkingCapability('openai-subscription', 'o3')!, value: 'low' } }))
  expect(body(2).reasoning).toEqual({ effort: 'low' })
})
it('preserves signed Anthropic thinking during tool follow-ups without displaying it', async () => {
  fetchMock.mockResolvedValueOnce(stream([
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Private thought' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'signed' } },
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'call', name: 'inspect' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{}' } },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
  ])).mockResolvedValueOnce(stream([
    { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Done' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
  ]))
  const onChunk = vi.fn()
  expect(await sendMessage(opts({ provider: 'anthropic', model: 'claude-sonnet-4-6', onChunk, thinking: { capability: thinkingCapability('anthropic', 'claude-sonnet-4-6')!, value: 'medium' }, tools: [{ name: 'inspect', description: 'Inspect', inputSchema: { type: 'object', properties: {}, required: [] } }], onToolCall: async () => 'Result' }))).toBe('Done')
  expect(onChunk).toHaveBeenCalledExactlyOnceWith('Done')
  expect(body(1).messages[1].content[0]).toEqual({ type: 'thinking', thinking: 'Private thought', signature: 'signed' })
  for (const index of [0, 1]) { expect(body(index).output_config).toEqual({ effort: 'medium' }); expect(body(index).thinking).toEqual({ type: 'adaptive' }) }
})
it('sends Gemini thinking configuration and echoes function thought signatures unchanged', async () => {
  fetchMock.mockResolvedValueOnce(stream([{ candidates: [{ content: { parts: [{ text: 'hidden', thought: true }, { functionCall: { name: 'inspect', args: {} }, thoughtSignature: 'opaque' }] } }] }]))
    .mockResolvedValueOnce(stream([{ candidates: [{ content: { parts: [{ text: 'Done' }] } }] }]))
  const onChunk = vi.fn()
  await sendMessage(opts({ provider: 'google', model: 'gemini-2.5-pro', onChunk, maxOutputTokens: 12000, thinking: { capability: thinkingCapability('google', 'gemini-2.5-pro')!, value: '8192' }, tools: [{ name: 'inspect', description: 'Inspect', inputSchema: { type: 'object', properties: {}, required: [] } }], onToolCall: async () => 'Result' }))
  expect(body().generationConfig).toEqual({ maxOutputTokens: 12000, thinkingConfig: { thinkingBudget: 8192 } })
  expect(body(1).contents[1].parts[1].thoughtSignature).toBe('opaque')
  expect(onChunk).toHaveBeenCalledExactlyOnceWith('Done')
})
it('uses native Ollama boolean controls', async () => {
  fetchMock.mockResolvedValue({ ok: true, status: 200, body: null, text: vi.fn(), json: async () => ({ message: { content: 'Done' } }) })
  const capability = ollamaThinkingCapability({ thinking: { values: [false, true] } }, 'custom')!
  await sendMessage(opts({ provider: 'ollama', model: 'custom', thinking: { capability, value: 'on' }, tools: [{ name: 'inspect', description: 'Inspect', inputSchema: { type: 'object', properties: {}, required: [] } }], onToolCall: async () => '' }))
  expect(body().think).toBe(true)
  await sendMessage(opts({ provider: 'ollama', model: 'custom', thinking: { capability, value: 'off' }, tools: [{ name: 'inspect', description: 'Inspect', inputSchema: { type: 'object', properties: {}, required: [] } }], onToolCall: async () => '' }))
  expect(body(1).think).toBe(false)
})
it('passes a validated effort flag to Claude Code and never turns an unknown value into an argument', () => {
  const spec = { binary: '/claude', systemPromptFile: '/prompt', model: 'sonnet', sessionId: 'id', resume: false, tools: [], cwd: '.', mcpConfigFile: null } as ClaudeRunSpec
  expect(buildClaudeArgs({ ...spec, effort: 'high' })).toContain('--effort')
  expect(buildClaudeArgs(spec)).not.toContain('--effort')
  expect(buildClaudeArgs({ ...spec, effort: '--dangerous' })).not.toContain('--effort')
})

it('refuses a truncated tool request before executing any tool', async () => {
  fetchMock.mockResolvedValue(stream([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'partial', function: { name: 'inspect', arguments: '{' } }] }, finish_reason: 'length' }] }]))
  const onToolCall = vi.fn()
  await expect(sendMessage(opts({ onToolCall, tools: [{ name: 'inspect', description: 'Inspect', inputSchema: { type: 'object', properties: {}, required: [] } }] }))).rejects.toThrow('output limit')
  expect(onToolCall).not.toHaveBeenCalled()
})
it('sends Gemini levels with its output cap and preserves a zero thinking budget', async () => {
  fetchMock.mockResolvedValue(stream([{ candidates: [{ content: { parts: [{ text: 'Done' }] } }] }]))
  await sendMessage(opts({ provider: 'google', model: 'gemini-3-pro-preview', maxOutputTokens: 8000, thinking: { capability: thinkingCapability('google', 'gemini-3-pro-preview')!, value: 'low' } }))
  expect(body().generationConfig).toEqual({ maxOutputTokens: 8000, thinkingConfig: { thinkingLevel: 'low' } })
  await sendMessage(opts({ provider: 'google', model: 'gemini-2.5-flash', thinking: { capability: thinkingCapability('google', 'gemini-2.5-flash')!, value: 'off' } }))
  expect(body(1).generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 })
})
