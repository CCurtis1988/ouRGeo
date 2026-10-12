import { expect, it, vi } from 'vitest'
import { requestInvocation, sendMessage, type SendOptions } from './ai-client'
import { proxyFetch } from './ai-proxy-fetch'
import type { ProxyResponse } from './ai-proxy-fetch'
vi.mock('./ai-proxy-fetch', () => ({ proxyFetch: vi.fn() }))

const rejected = (status = 400, raw = '{"error":{"code":"context_length_exceeded"}}'): ProxyResponse => ({ ok: false, status, body: null, text: async () => raw, json: async () => JSON.parse(raw) })
const accepted = (): ProxyResponse => ({ ok: true, status: 200, body: null, text: async () => '', json: async () => ({}) })
const options = (): SendOptions => ({ provider: 'openai', model: 'fixture', apiKey: '', messages: [], systemPrompt: 'Essential rules.', contextSize: 32000, onChunk: () => undefined })
const history = () => [{ role: 'user', content: 'Keep exact 12.5 feet.' }, { role: 'assistant', content: 'Earlier optional answer. '.repeat(1000) }, { role: 'user', content: 'Continue.' }, { role: 'assistant', content: 'Current task state.' }]

it('checks both invocations and retries once with smaller input without replaying a tool', async () => {
  const opts = options(), messages = history(), payloads: string[] = []
  opts.beforeInvocation = vi.fn()
  opts.onToolCall = vi.fn(async () => 'must not execute')
  const request = vi.fn(async () => { payloads.push(JSON.stringify(messages)); return payloads.length === 1 ? rejected() : accepted() })
  expect((await requestInvocation(opts, messages, 'openai', () => messages, request)).ok).toBe(true)
  expect(request).toHaveBeenCalledTimes(2)
  expect(payloads[1].length).toBeLessThan(payloads[0].length)
  expect(opts.beforeInvocation).toHaveBeenCalledTimes(2)
  expect(opts.onToolCall).not.toHaveBeenCalled()
  await expect(requestInvocation(opts, history(), 'openai', () => messages, async () => rejected())).rejects.toThrow('BUDGET_LIMIT')
})

it('stops after the rebuilt input is rejected and preserves an actionable recovery move', async () => {
  const messages = history(), request = vi.fn(async () => rejected())
  await expect(requestInvocation(options(), messages, 'openai', () => messages, request)).rejects.toThrow('No further automatic retry')
  expect(request).toHaveBeenCalledTimes(2)
})

it('returns non-context errors intact and makes no retry when essential input cannot shrink', async () => {
  const messages = history(), raw = '{"error":{"message":"Authorisation refused"}}'
  const request = vi.fn(async () => rejected(401, raw))
  const response = await requestInvocation(options(), messages, 'openai', () => messages, request)
  expect(await response.text()).toBe(raw)
  expect(await response.json()).toEqual(JSON.parse(raw))
  expect(request).toHaveBeenCalledTimes(1)
  const essential = [{ role: 'user', content: 'Original instructions.' }]
  const overflow = vi.fn(async () => rejected())
  await expect(requestInvocation(options(), essential, 'openai', () => essential, overflow)).rejects.toThrow('essential input cannot be reduced safely')
  expect(overflow).toHaveBeenCalledTimes(1)
})

it('rechecks cancellation before a recovery dispatch', async () => {
  const opts = options(), controller = new AbortController(), messages = history()
  opts.signal = controller.signal
  const request = vi.fn(async () => { controller.abort(); return rejected() })
  await expect(requestInvocation(opts, messages, 'openai', () => messages, request)).rejects.toThrow()
  expect(request).toHaveBeenCalledTimes(1)
})

it('retries a rejected tool-loop follow-up without executing the successful action twice', async () => {
  const stream = (chunk: unknown): ProxyResponse => {
    const bytes = new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`)
    let consumed = false
    return { ...accepted(), body: { getReader: () => ({ read: async () => { if (consumed) return { done: true }; consumed = true; return { done: false, value: bytes } } }) } }
  }
  const fetch = vi.mocked(proxyFetch)
  fetch.mockReset()
  fetch.mockResolvedValueOnce(stream({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'action-1', function: { name: 'action', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] }))
    .mockResolvedValueOnce(rejected())
    .mockResolvedValueOnce(stream({ choices: [{ delta: { content: 'Done.' }, finish_reason: 'stop' }] }))
  const onToolCall = vi.fn(async () => 'Action successfully completed once.'), beforeInvocation = vi.fn()
  const messages = history().map((message, index) => ({ ...message, id: String(index), role: message.role as 'user' | 'assistant', timestamp: index }))
  expect(await sendMessage({ ...options(), messages, beforeInvocation, onToolCall, tools: [{ name: 'action', description: 'Run the authorised action', inputSchema: { type: 'object', properties: {}, required: [] } }] })).toBe('Done.')
  expect(onToolCall).toHaveBeenCalledTimes(1)
  expect(fetch).toHaveBeenCalledTimes(3)
  expect(beforeInvocation).toHaveBeenCalledTimes(3)
  const failed = JSON.parse(fetch.mock.calls[1][1]!.body!), rebuilt = JSON.parse(fetch.mock.calls[2][1]!.body!)
  expect(JSON.stringify(rebuilt).length).toBeLessThan(JSON.stringify(failed).length)
  expect(rebuilt.messages.filter((message: { role: string }) => message.role === 'tool')).toEqual(failed.messages.filter((message: { role: string }) => message.role === 'tool'))
  expect(rebuilt.messages.find((message: { tool_calls?: unknown }) => message.tool_calls)).toEqual(failed.messages.find((message: { tool_calls?: unknown }) => message.tool_calls))
  expect(messages[1].content).toContain('Earlier optional answer.')
})

it('awaits durable reservation before dispatch and checks every overflow retry separately', async () => {
  const opts = options(), messages = history(), events: string[] = []
  opts.beforeInvocation = () => { events.push('count') }
  opts.beforeDispatch = async () => { await Promise.resolve(); events.push('reserve') }
  const request = vi.fn(async () => { events.push('dispatch'); return request.mock.calls.length === 1 ? rejected() : accepted() })
  await requestInvocation(opts, messages, 'openai', () => messages, request)
  expect(events).toEqual(['count', 'reserve', 'dispatch', 'count', 'reserve', 'dispatch'])
})
it('stops a budget-rejected follow-up before sending and rechecks cancellation after reservation', async () => {
  const opts = options(), request = vi.fn(async () => accepted())
  opts.beforeDispatch = async () => { throw new Error('BUDGET_LIMIT: estimate covered') }
  await expect(requestInvocation(opts, history(), 'openai', () => history(), request)).rejects.toThrow('BUDGET_LIMIT')
  expect(request).not.toHaveBeenCalled()
  const controller = new AbortController()
  opts.signal = controller.signal
  opts.beforeDispatch = async () => { controller.abort() }
  await expect(requestInvocation(opts, history(), 'openai', () => history(), request)).rejects.toThrow()
  expect(request).not.toHaveBeenCalled()
})
