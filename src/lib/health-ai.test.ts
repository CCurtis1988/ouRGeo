import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sendMessage, type SendOptions } from './ai-client'
import { proxyFetch } from './ai-proxy-fetch'

vi.mock('./ai-proxy-fetch', () => ({ proxyFetch: vi.fn() }))
const fetchMock = vi.mocked(proxyFetch)
function response() {
  let sent = false
  return {
    ok: true, status: 200, text: async () => '', json: async () => ({}),
    body: { getReader: () => ({ read: async () => {
      if (sent) return { done: true }
      sent = true
      return { done: false, value: new TextEncoder().encode('{"message":{"content":"Ready"},"done":true}\n') }
    } }) },
  }
}
const opts: SendOptions = { provider: 'ollama', model: 'qwen3:4b', apiKey: '', localUrl: 'http://127.0.0.1:11434', messages: [{ id: 'health', role: 'user', content: 'Reply with the word Ready.', timestamp: 0 }], systemPrompt: 'Connection test.', onChunk: () => {} }
beforeEach(() => { vi.clearAllMocks(); fetchMock.mockResolvedValue(response()) })
describe('local assistant diagnostic resource limits', () => {
  it('bounds diagnostic output and memory, disables thinking, and offers no tools', async () => {
    expect(await sendMessage({ ...opts, testConnection: true, maxOutputTokens: 512 })).toBe('Ready')
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body!)
    expect(body.options).toEqual({ num_ctx: 4096, num_predict: 512 })
    expect(body.think).toBe(false)
    expect(body.tools).toBeUndefined()
    expect(body.messages).toHaveLength(2)
  })
  it('keeps the wizard’s chosen context limit during subsequent assistant conversations', async () => {
    await sendMessage({ ...opts, ollamaContextSize: 4096 })
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body!).options).toEqual({ num_ctx: 4096 })
  })
  it('leaves the server’s existing defaults intact without a context override', async () => {
    await sendMessage(opts)
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body!).options).toBeUndefined()
  })
  it('uses the configured bearer token for an authenticated Ollama server', async () => {
    await sendMessage({ ...opts, localApiKey: 'server-token' })
    expect(fetchMock.mock.calls[0][1]!.headers!.Authorization).toBe('Bearer server-token')
  })
})
