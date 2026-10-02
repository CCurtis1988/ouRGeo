import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMain } from 'electron'

const state = vi.hoisted(() => ({
  dir: '', encrypted: true, browser: '',
  callback: null as null | ((req: unknown, res: unknown) => Promise<void>),
  fetch: vi.fn(), close: vi.fn(), handlers: new Map<string, (...args: any[]) => any>(),
}))
vi.mock('electron', () => ({
  app: { getPath: () => state.dir, on: vi.fn() },
  net: { fetch: (...args: unknown[]) => state.fetch(...args) },
  shell: { openExternal: async (url: string) => { state.browser = url } },
  safeStorage: {
    isEncryptionAvailable: () => state.encrypted,
    getSelectedStorageBackend: () => state.encrypted ? 'gnome_libsecret' : 'basic_text',
    encryptString: (text: string) => Buffer.from(text).map((b) => b ^ 0xff),
    decryptString: (data: Buffer) => Buffer.from(data).map((b) => b ^ 0xff).toString(),
  },
}))
vi.mock('node:http', () => ({
  createServer: (callback: typeof state.callback) => {
    state.callback = callback
    return { once: vi.fn(), listen: (_port: number, _host: string, ready: () => void) => ready(), address: () => ({ port: 1455 }), close: state.close }
  },
}))
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const key = { ...publicKey.export({ format: 'jwk' }), kid: 'test', alg: 'RS256' }
let module: typeof import('./chatgpt-subscription')
let subject = 'user-1'
let permission = true
let expiry = 3600
function signedIdentity(clientId: string) {
  const nonce = new URL(state.browser).searchParams.get('nonce')
  const payload = [
    Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test' })).toString('base64url'),
    Buffer.from(JSON.stringify({ iss: 'https://auth.openai.com', aud: clientId, sub: subject, email: 'same@example.com', exp: Date.now() / 1000 + 3600, nonce })).toString('base64url'),
  ].join('.')
  return `${payload}.${sign('sha256', Buffer.from(payload), privateKey).toString('base64url')}`
}
async function callback(clientId = 'oaiapp_1', overrides: Record<string, string> = {}) {
  const params = new URLSearchParams({ state: new URL(state.browser).searchParams.get('state')!, code: 'code', client_id: clientId, ...overrides })
  const res = { writeHead: vi.fn().mockReturnThis(), end: vi.fn() }
  await state.callback!({ method: 'GET', url: `/auth/callback?${params}` }, res)
  return res
}
async function invoke(name: string, ...args: unknown[]) { return state.handlers.get(`chatgpt:${name}`)!({}, ...args) }

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks()
  state.dir = await mkdtemp(join(tmpdir(), 'ourgeo-chatgpt-test-'))
  state.encrypted = true; subject = 'user-1'; permission = true; expiry = 3600
  state.handlers.clear()
  state.fetch.mockImplementation(async (url: string, init?: { body?: string }) => {
    if (url.endsWith('jwks.json')) return { ok: true, json: async () => ({ keys: [key] }) }
    if (url.endsWith('openid-configuration')) return { ok: true, json: async () => ({ revocation_endpoint: 'https://auth.openai.com/revoke' }) }
    if (url.endsWith('/revoke')) return { ok: true }
    if (url.endsWith('/models')) return { ok: true, json: async () => ({ models: [
      { slug: 'eligible', display_name: 'Eligible model', visibility: 'list' },
      { slug: 'hidden', visibility: 'hidden' },
    ] }) }
    const clientId = new URLSearchParams(init?.body).get('client_id')!
    return { ok: true, json: async () => ({ access_token: 'access-secret', refresh_token: 'refresh-secret', id_token: signedIdentity(clientId),
      token_type: 'Bearer', expires_in: expiry, scope: `openid email${permission ? ' chatgpt.tokens.use.direct' : ''}` }) }
  })
  module = await import('./chatgpt-subscription')
  module.registerChatGptHandlers({ handle: (name: string, handler: (...args: any[]) => any) => state.handlers.set(name, handler) } as unknown as IpcMain)
})
afterEach(async () => { await invoke('cancel'); await rm(state.dir, { recursive: true, force: true }) })

describe('ChatGPT subscription connection', () => {
  it('registers with PKCE, exchanges using the issued client, and keeps all credentials out of IPC and metadata', async () => {
    await module.beginChatGptSignIn()
    const url = new URL(state.browser)
    expect(url.searchParams.get('client_id')).toBe('dynamic_agent_client')
    expect(url.searchParams.get('agent_name_hint')).toBe('ouRGeo')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    await callback()
    const status = await module.chatGptStatus()
    expect(status).toMatchObject({ signedIn: true, planEnabled: true, activeId: 'oaiapp_1', signingIn: false })
    expect(JSON.stringify(status)).not.toMatch(/access-secret|refresh-secret/)
    const metadata = await readFile(join(state.dir, 'chatgpt-accounts.json'), 'utf8')
    expect(metadata).not.toMatch(/access-secret|refresh-secret|id_token/)
    expect((await readFile(join(state.dir, 'chatgpt-session.bin'))).toString()).not.toContain('refresh-secret')
    const exchange = state.fetch.mock.calls.find(([u]) => String(u).endsWith('/oauth/token'))![1]
    const form = new URLSearchParams(exchange.body)
    expect(form.get('client_id')).toBe('oaiapp_1')
    expect(form.get('redirect_uri')).toBe(url.searchParams.get('redirect_uri'))
    expect(await module.chatGptModels()).toEqual([{ id: 'eligible', label: 'Eligible model' }])
  })
  it('rejects a forged callback state before making any token request', async () => {
    await module.beginChatGptSignIn()
    const res = await callback('oaiapp_1', { state: 'forged' })
    expect(res.writeHead).toHaveBeenCalledWith(400)
    expect(state.fetch).not.toHaveBeenCalled()
    expect((await module.chatGptStatus()).signedIn).toBe(false)
  })
  it('retains sign-in without plan permission but refuses inference until explicit consent', async () => {
    permission = false
    await module.beginChatGptSignIn(); await callback()
    expect(await module.chatGptStatus()).toMatchObject({ signedIn: true, planEnabled: false })
    await expect(module.chatGptAccessToken()).rejects.toThrow('Enable ChatGPT plan usage')
    await module.beginChatGptSignIn('oaiapp_1')
    expect(new URL(state.browser).searchParams.get('prompt')).toBe('consent')
    expect(new URL(state.browser).searchParams.get('client_id')).toBe('oaiapp_1')
  })
  it('serialises refresh rotation and keeps credentials after a temporary failure', async () => {
    expiry = 30
    await module.beginChatGptSignIn(); await callback()
    state.fetch.mockClear()
    await Promise.all([module.chatGptAccessToken(), module.chatGptAccessToken()])
    expect(state.fetch).toHaveBeenCalledTimes(1)
    expect(new URLSearchParams(state.fetch.mock.calls[0][1].body).get('grant_type')).toBe('refresh_token')
    state.fetch.mockRejectedValueOnce(new Error('temporary network error'))
    await expect(module.chatGptAccessToken()).rejects.toThrow('temporary network error')
    expect((await module.chatGptStatus()).signedIn).toBe(true)
    state.fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'invalid_grant' }) })
    await expect(module.chatGptAccessToken()).rejects.toThrow('Sign in again')
    expect((await module.chatGptStatus()).signedIn).toBe(false)
  })
  it('keeps same-email registrations separate and rejects account substitution on reauthorisation', async () => {
    await module.beginChatGptSignIn(); await callback()
    await module.beginChatGptSignIn('oaiapp_1'); subject = 'other-user'; await callback()
    expect((await module.chatGptStatus()).error).toContain('different ChatGPT account')
    expect((await module.chatGptStatus()).accounts).toHaveLength(1)
    await module.beginChatGptSignIn(); await callback('oaiapp_2')
    expect((await module.chatGptStatus()).accounts).toHaveLength(2)
    await invoke('select', 'oaiapp_1')
    await expect(module.chatGptRequestToken('oaiapp_2')).rejects.toThrow('account changed')
    await invoke('signOut')
    await module.beginChatGptSignIn('oaiapp_1')
    expect(new URL(state.browser).searchParams.get('client_id')).toBe('oaiapp_1')
    expect(new URL(state.browser).searchParams.has('id_token_hint')).toBe(false)
  })
  it('keeps tokens in memory when the OS keyring is unavailable', async () => {
    state.encrypted = false
    await module.beginChatGptSignIn(); await callback()
    expect(await module.chatGptStatus()).toMatchObject({ persistent: false, signedIn: true })
    await expect(readFile(join(state.dir, 'chatgpt-session.bin'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('clears local tokens and reports unconfirmed remote revocation', async () => {
    await module.beginChatGptSignIn(); await callback()
    state.fetch.mockRejectedValueOnce(new Error('offline'))
    expect(await invoke('signOut')).toMatchObject({ signedIn: false, error: expect.stringContaining('Remote revocation was not confirmed') })
  })
})
