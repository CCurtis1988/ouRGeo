import { app, net, safeStorage, shell, type IpcMain } from 'electron'
import { createServer, type Server } from 'node:http'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFile, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { validateChatGptIdentity } from './chatgpt-identity'

// Official public-client flow for OSS desktop apps. These are ouRGeo's own
// grants: neither Codex credentials nor a user's API key is read or reused.
const AUTH = 'https://auth.openai.com'
const RESOURCE = 'https://api.openai.com/v1'
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
interface Tokens {
  access: string; refresh: string; id: string; expiresAt: number; scopes: string[]
}
interface Account {
  clientId: string; subject: string; email: string | null; tokens?: Tokens
}
interface Registry { hostId: string; activeId: string | null; accounts: Account[] }
interface TokenReply {
  access_token: string; refresh_token?: string; id_token?: string
  token_type: string; expires_in: number; scope?: string
}
interface Pending { server: Server; timer: ReturnType<typeof setTimeout>; cancel: () => void }
let registry: Registry = { hostId: `urn:uuid:${randomUUID()}`, activeId: null, accounts: [] }
let initialized: Promise<void> | null = null
let writes = Promise.resolve()
let pending: Pending | null = null
let error: string | null = null
let revision = 0
const refreshes = new Map<string, Promise<string>>()
const changes = new Set<() => void>()

const file = (name: string) => join(app.getPath('userData'), name)
const protectedStorage = () => safeStorage.isEncryptionAvailable()
  && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
const selected = () => registry.accounts.find((a) => a.clientId === registry.activeId)
const changed = () => { revision++; for (const callback of changes) callback() }
export function onChatGptAccountChange(callback: () => void): void { changes.add(callback) }

async function persist(): Promise<void> {
  // Serialise BOTH files from the same snapshot. Refresh rotation must not
  // leave an older token on disk when two requests finish out of order.
  const metadata = JSON.stringify({ ...registry, accounts: registry.accounts.map(({ tokens: _tokens, ...a }) => a) })
  const credentials = protectedStorage() ? safeStorage.encryptString(JSON.stringify(registry.accounts)) : null
  const next = writes.catch(() => {}).then(async () => {
    const path = file('chatgpt-accounts.json')
    await writeFile(`${path}.tmp`, metadata, { mode: 0o600 })
    await rename(`${path}.tmp`, path)
    const tokenPath = file('chatgpt-session.bin')
    if (credentials) {
      await writeFile(`${tokenPath}.tmp`, credentials, { mode: 0o600 })
      await rename(`${tokenPath}.tmp`, tokenPath)
    } else await rm(tokenPath, { force: true })
  })
  writes = next
  await next
}

async function init(): Promise<void> {
  initialized ??= (async () => {
    try {
      const saved = JSON.parse(await readFile(file('chatgpt-accounts.json'), 'utf8')) as Registry
      if (typeof saved.hostId !== 'string' || !Array.isArray(saved.accounts)) throw new Error('Invalid account file')
      registry = { ...saved, accounts: saved.accounts.map(({ tokens: _tokens, ...a }) => a) }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') error = 'Saved ChatGPT accounts could not be read. Sign in again.'
    }
    if (protectedStorage()) {
      try {
        const accounts = JSON.parse(safeStorage.decryptString(await readFile(file('chatgpt-session.bin')))) as Account[]
        for (const a of registry.accounts) {
          a.tokens = accounts.find((saved) => saved.clientId === a.clientId && saved.subject === a.subject)?.tokens
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') error = 'Saved ChatGPT credentials could not be unlocked. Sign in again.'
      }
    }
  })()
  await initialized
}

async function tokenRequest(params: Record<string, string>): Promise<TokenReply> {
  const response = await net.fetch(`${AUTH}/api/accounts/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, resource: RESOURCE }).toString(),
    signal: AbortSignal.timeout(30_000),
  })
  const data = await response.json() as TokenReply & { error?: string }
  if (!response.ok) {
    const failure = new Error(response.status >= 500
      ? 'ChatGPT authorisation is temporarily unavailable. Try again later.'
      : 'ChatGPT authorisation failed. Sign in again in Settings → AI Assistant.') as Error & { code?: string }
    failure.code = data.error
    throw failure
  }
  if (typeof data.access_token !== 'string' || data.token_type?.toLowerCase() !== 'bearer'
    || !Number.isFinite(data.expires_in) || data.expires_in <= 0) {
    throw new Error('OpenAI returned incomplete credentials. Sign in again.')
  }
  return data
}

function tokensFrom(data: TokenReply, previous?: Tokens): Tokens {
  return {
    access: data.access_token, refresh: data.refresh_token ?? previous?.refresh ?? '',
    id: data.id_token ?? previous?.id ?? '', expiresAt: Date.now() + data.expires_in * 1000,
    scopes: data.scope === undefined ? previous?.scopes ?? [] : data.scope.split(/\s+/),
  }
}

export async function chatGptStatus() {
  await init()
  const account = selected()
  return {
    activeId: registry.activeId, signingIn: !!pending, error,
    persistent: protectedStorage(),
    accounts: registry.accounts.map((a) => ({
      id: a.clientId, email: a.email, signedIn: !!a.tokens,
      planEnabled: a.tokens?.scopes.includes('chatgpt.tokens.use.direct') ?? false,
    })),
    signedIn: !!account?.tokens,
    planEnabled: account?.tokens?.scopes.includes('chatgpt.tokens.use.direct') ?? false,
  }
}

export async function beginChatGptSignIn(accountId?: string): Promise<void> {
  await init()
  pending?.cancel()
  error = null
  const account = accountId ? registry.accounts.find((a) => a.clientId === accountId) : undefined
  if (accountId && !account) throw new Error('Choose a saved ChatGPT account or add an account.')
  await persist() // The host ID must survive even a cancelled first registration.
  const state = randomBytes(32).toString('base64url')
  const nonce = randomBytes(32).toString('base64url')
  const verifier = randomBytes(64).toString('base64url')
  let redirect = ''
  let consumed = false
  let cancelled = false
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', redirect)
    if (req.method !== 'GET' || url.pathname !== '/auth/callback') { res.writeHead(404).end(); return }
    if (consumed || url.searchParams.get('state') !== state) { res.writeHead(400).end('Invalid sign-in callback.'); return }
    consumed = true
    try {
      if (url.searchParams.has('error')) throw new Error('ChatGPT sign-in was declined. Try again in Settings → AI Assistant.')
      const issued = url.searchParams.get('client_id') ?? account?.clientId
      const code = url.searchParams.get('code')
      if (!code || !issued || issued === 'dynamic_agent_client' || (account && issued !== account.clientId)) {
        throw new Error('ChatGPT registration was incomplete. Sign in again.')
      }
      const data = await tokenRequest({ grant_type: 'authorization_code', client_id: issued, code, code_verifier: verifier, redirect_uri: redirect })
      if (!data.id_token) throw new Error('OpenAI did not return an account identity. Sign in again.')
      const keyResponse = await net.fetch(`${AUTH}/.well-known/jwks.json`, { signal: AbortSignal.timeout(30_000) })
      if (!keyResponse.ok) throw new Error('Could not verify OpenAI’s account identity. Try signing in again.')
      const jwks = await keyResponse.json() as { keys: Parameters<typeof validateChatGptIdentity>[1] }
      const identity = validateChatGptIdentity(data.id_token, jwks.keys, issued, nonce)
      if (account && identity.subject !== account.subject) throw new Error('A different ChatGPT account signed in. Use Add account instead.')
      if (cancelled) { res.writeHead(400).end('Sign-in cancelled.'); return }
      const registration: Account = { clientId: issued, ...identity, tokens: tokensFrom(data) }
      const index = registry.accounts.findIndex((a) => a.clientId === issued)
      if (index >= 0 && registry.accounts[index].subject !== identity.subject) throw new Error('ChatGPT account identity changed. Sign in again.')
      if (index < 0) registry.accounts.push(registration)
      else registry.accounts[index] = registration
      registry.activeId = issued
      changed()
      await persist()
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
        .end('Signed in to ouRGeo. You can close this window and return to AI Assistant settings.')
    } catch (e) {
      if (!cancelled) error = e instanceof Error ? e.message : 'ChatGPT sign-in failed. Try again.'
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end('Sign-in failed. Return to ouRGeo for details.')
    } finally { attempt.cancel() }
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  redirect = `http://127.0.0.1:${(server.address() as { port: number }).port}/auth/callback`
  const attempt: Pending = {
    server, timer: setTimeout(() => { error = 'ChatGPT sign-in timed out. Try again.'; attempt.cancel() }, 5 * 60_000),
    cancel: () => { cancelled = true; clearTimeout(attempt.timer); server.close(); if (pending === attempt) pending = null },
  }
  pending = attempt
  const url = new URL(`${AUTH}/api/accounts/authorize`)
  const params: Record<string, string> = {
    client_id: account?.clientId ?? 'dynamic_agent_client', ext_agent_host_id: registry.hostId,
    response_type: 'code', redirect_uri: redirect, scope: SCOPES, resource: RESOURCE,
    state, nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'),
  }
  if (!account) params.agent_name_hint = 'ouRGeo'
  if (account?.tokens?.id) params.id_token_hint = account.tokens.id
  if (account?.email) params.login_hint = account.email
  if (account?.tokens && !account.tokens.scopes.includes('chatgpt.tokens.use.direct')) params.prompt = 'consent'
  url.search = new URLSearchParams(params).toString()
  try { await shell.openExternal(url.toString()) } catch (e) { attempt.cancel(); throw e }
}

export async function chatGptAccessToken(): Promise<string> {
  await init()
  const account = selected()
  if (!account?.tokens) throw new Error('Sign in with ChatGPT in Settings → AI Assistant first.')
  if (!account.tokens.scopes.includes('chatgpt.tokens.use.direct')) {
    throw new Error('Enable ChatGPT plan usage in Settings → AI Assistant before sending a message.')
  }
  if (account.tokens.expiresAt > Date.now() + 60_000) return account.tokens.access
  let refresh = refreshes.get(account.clientId)
  if (!refresh) {
    const generation = revision
    const previous = account.tokens
    refresh = (async () => {
      try {
        if (!previous.refresh) throw Object.assign(new Error('Sign in with ChatGPT again.'), { code: 'invalid_refresh_token' })
        const data = await tokenRequest({ grant_type: 'refresh_token', client_id: account.clientId, refresh_token: previous.refresh })
        if (generation !== revision || account.tokens !== previous) throw new Error('The ChatGPT account changed. Send the message again.')
        account.tokens = tokensFrom(data, previous)
        await persist()
        if (!account.tokens.scopes.includes('chatgpt.tokens.use.direct')) throw new Error('ChatGPT plan permission was removed. Enable it in Settings → AI Assistant.')
        return account.tokens.access
      } catch (e) {
        if (['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused'].includes((e as { code?: string }).code ?? '')
          && account.tokens === previous) {
          delete account.tokens
          changed()
          await persist()
        }
        throw e
      }
    })().finally(() => refreshes.delete(account.clientId))
    refreshes.set(account.clientId, refresh)
  }
  return refresh
}

export async function chatGptRequestToken(accountId: string | undefined): Promise<string> {
  await init()
  if (!accountId || registry.activeId !== accountId) throw new Error('The ChatGPT account changed. Send the message again.')
  const generation = revision
  const access = await chatGptAccessToken()
  if (generation !== revision) throw new Error('The ChatGPT account changed. Send the message again.')
  return access
}

export async function chatGptModels(): Promise<{ id: string; label: string }[]> {
  const generation = revision
  const access = await chatGptAccessToken()
  const response = await net.fetch(`${RESOURCE}/models`, {
    headers: { Authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`ChatGPT models could not be loaded (HTTP ${response.status}). Check your plan access and try Refresh.`)
  const data = await response.json() as { models?: { slug: string; display_name?: string; visibility?: string }[] }
  if (generation !== revision) throw new Error('The ChatGPT account changed. Refresh the model list.')
  return (data.models ?? []).filter((m: { slug?: string; visibility?: string }) => m.visibility === 'list' && typeof m.slug === 'string')
    .map((m: { slug: string; display_name?: string }) => ({ id: m.slug, label: m.display_name ?? m.slug }))
}

export function registerChatGptHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('chatgpt:status', () => chatGptStatus())
  ipcMain.handle('chatgpt:signIn', (_event, id?: string) => beginChatGptSignIn(id))
  ipcMain.handle('chatgpt:cancel', () => { pending?.cancel() })
  ipcMain.handle('chatgpt:models', () => chatGptModels())
  ipcMain.handle('chatgpt:select', async (_event, id: string) => {
    await init()
    if (!registry.accounts.some((a) => a.clientId === id)) throw new Error('Choose a saved ChatGPT account.')
    pending?.cancel(); registry.activeId = id; error = null; changed(); await persist()
  })
  ipcMain.handle('chatgpt:signOut', async () => {
    await init(); pending?.cancel()
    const account = selected()
    const tokens = account?.tokens
    if (account) delete account.tokens
    changed(); await persist()
    let revoked = !tokens?.refresh
    if (tokens?.refresh && account) {
      try {
        const discovery = await net.fetch(`${AUTH}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(15_000) })
        const metadata = await discovery.json() as { revocation_endpoint: string }
        const endpoint = new URL(metadata.revocation_endpoint)
        if (endpoint.origin !== AUTH) throw new Error('Invalid revocation endpoint')
        const response = await net.fetch(endpoint.toString(), {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: tokens.refresh, token_type_hint: 'refresh_token', client_id: account.clientId }).toString(),
          signal: AbortSignal.timeout(15_000),
        })
        revoked = response.ok
      } catch { /* Local sign-out still succeeds when OpenAI is unreachable. */ }
    }
    error = revoked ? null : 'Signed out locally. Remote revocation was not confirmed; disconnect ouRGeo in ChatGPT Settings → Usage.'
    return chatGptStatus()
  })
  ipcMain.handle('chatgpt:usage', () => shell.openExternal('https://chatgpt.com/settings/usage'))
  app.on('before-quit', () => pending?.cancel())
}
