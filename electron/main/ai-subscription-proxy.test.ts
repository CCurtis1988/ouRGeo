import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'

const state = vi.hoisted(() => ({
  fetch: vi.fn(), token: vi.fn(), changed: null as null | (() => void),
  handlers: new Map<string, (...args: any[]) => any>(),
}))
vi.mock('electron', () => ({ net: { fetch: (...args: unknown[]) => state.fetch(...args) } }))
vi.mock('./chatgpt-subscription', () => ({
  chatGptRequestToken: (...args: unknown[]) => state.token(...args),
  onChatGptAccountChange: (callback: () => void) => { state.changed = callback },
}))
import { registerAiProxy } from './ai-proxy'

const request = { url: 'https://api.openai.com/v1/responses', method: 'POST', billing: 'chatgpt', billingAccountId: 'account',
  body: JSON.stringify({ input: [], store: false, stream: true }), headers: { Authorization: 'Bearer api-key' } }
const owner = () => ({ isDestroyed: () => false, send: vi.fn() })
beforeEach(() => {
  vi.clearAllMocks(); state.handlers.clear()
  state.token.mockResolvedValue('subscription-secret')
  state.fetch.mockResolvedValue({ ok: true, status: 200, body: null })
  registerAiProxy({ on: (name: string, handler: (...args: any[]) => any) => state.handlers.set(name, handler) } as unknown as IpcMain)
})
describe('subscription credentials at the main-process network boundary', () => {
  it('attaches only the selected account credential and never returns it to the renderer', async () => {
    const sender = owner()
    await state.handlers.get('ai:fetch')!({ sender }, 'run', request)
    expect(state.token).toHaveBeenCalledWith('account')
    expect(state.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer subscription-secret')
    expect(JSON.stringify(sender.send.mock.calls)).not.toContain('subscription-secret')
  })
  it.each([
    { url: 'https://attacker.example/collect' }, { url: 'https://api.openai.com/v1/chat/completions' },
    { url: 'https://api.openai.com/v1/responses?redirect=evil' }, { method: 'GET' },
    { body: '{"input":[],"store":true,"stream":true}' },
  ])('refuses credentials for a different endpoint or stored response (%j)', async (overrides) => {
    const sender = owner()
    await state.handlers.get('ai:fetch')!({ sender }, 'run', { ...request, ...overrides })
    expect(state.token).not.toHaveBeenCalled()
    expect(state.fetch).not.toHaveBeenCalled()
    expect(sender.send).toHaveBeenCalledWith('ai:error:run', expect.any(String))
  })
  it('settles the renderer request when an account change cancels it during authentication', async () => {
    const sender = owner()
    let resolve!: (value: string) => void
    state.token.mockImplementationOnce(() => new Promise<string>((done) => { resolve = done }))
    const run = state.handlers.get('ai:fetch')!({ sender }, 'run', request)
    state.changed!(); resolve('subscription-secret'); await run
    expect(state.fetch).not.toHaveBeenCalled()
    expect(sender.send).toHaveBeenCalledWith('ai:error:run', expect.stringContaining('stopped'))
  })
})
