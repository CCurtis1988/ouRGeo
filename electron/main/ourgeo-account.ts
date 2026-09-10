import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage, shell } from 'electron'

// One ouRGeo account, and everything that speaks to it.
//
// ourgeo.dev is a static site on Supabase: there is no bespoke API, so this
// module speaks PostgREST and GoTrue directly. It was `forum.ts` in full until
// the plugin store needed the same session — and the account IS one account.
// Two modules each holding their own would mean signing in twice for two
// features of one website, and a sign-out from one leaving the other signed in.
//
// ALL of it lives in the main process on purpose. The access token never
// reaches the renderer, so a bug (or an injected script) in the UI cannot act
// as the user or read their credentials — the renderer can only ask for the
// specific operations `forum.ts` and `plugin-store.ts` expose.
//
// Auth is PKCE with a loopback redirect, which is what lets one flow cover all
// three sign-in methods:
//   * google / github → /auth/v1/authorize in the user's real browser
//   * email           → /auth/v1/otp, a magic link that lands on the same
//                       loopback
// In both cases the code_verifier stays in this process, so nothing that
// arrives over the loopback is useful to anyone else.

export const SUPABASE_URL = 'https://tdtkuagfaiyasscnvaoh.supabase.co'
// Publishable by design — it identifies the project and grants nothing. Every
// table is behind RLS, enforced by Postgres. See the site's assets/js/config.js.
export const SUPABASE_ANON_KEY = 'sb_publishable_OK5HP-0fKEAQypRsB0jHtA_bg3UZ9fT'

/**
 * Ports tried in order for the OAuth redirect.
 *
 * Fixed rather than ephemeral because every one of them has to be listed in
 * Supabase → Authentication → URL Configuration → Redirect URLs; a random port
 * could not be allow-listed in advance.
 */
const LOOPBACK_PORTS = [8788, 8789, 8790]

export type Provider = 'google' | 'github' | 'email'

// ── Session storage ─────────────────────────────────────────────────────────

interface Session {
  accessToken: string
  refreshToken: string
  /** Epoch ms. */
  expiresAt: number
}

let session: Session | null = null

const tokenFile = (): string => join(app.getPath('userData'), 'forum-session.bin')

/**
 * Persist the refresh token, encrypted by the OS keychain.
 *
 * Unlike an API key, this token grants the ability to act as the user, so it
 * gets stronger treatment than the plaintext api-keys.json convention. When no
 * keyring is available (a bare Linux box), encryption is simply unavailable and
 * we keep nothing — the user signs in again next launch, which is a better
 * outcome than writing the credential to disk in the clear.
 *
 * The file is still called forum-session.bin. Renaming it would sign every
 * existing user out for a refactor they cannot see.
 */
async function saveRefreshToken(token: string | null): Promise<void> {
  const path = tokenFile()
  if (!token) {
    await unlink(path).catch(() => {})
    return
  }
  if (!safeStorage.isEncryptionAvailable()) return
  await writeFile(path, safeStorage.encryptString(token)).catch(() => {})
}

async function loadRefreshToken(): Promise<string | null> {
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(await readFile(tokenFile()))
  } catch {
    return null
  }
}

/**
 * Is there a stored session on this machine, without asking the network?
 *
 * A pure disk check, and the distinction it draws is what the plugin store's
 * dialog needs: it has to decide between "Install" and "Sign in to install"
 * before it draws anything, and `restoreSession()` is a refresh grant plus a
 * profile fetch — two round trips ouRGeo has never spent at startup and should
 * not start spending because a second dialog exists.
 */
export function hasStoredSession(): boolean {
  if (session) return true
  if (!safeStorage.isEncryptionAvailable()) return false
  try {
    return existsSync(tokenFile())
  } catch {
    return false
  }
}

export function isSignedIn(): boolean {
  return session !== null
}

// ── GoTrue ──────────────────────────────────────────────────────────────────

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function makePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(64))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  error_description?: string
  msg?: string
  error?: string
}

async function tokenRequest(grant: string, body: unknown): Promise<Session> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=${grant}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as TokenResponse
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.msg || data.error || 'Sign-in failed.')
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    // A minute of slack, so a call started just under the wire doesn't land
    // after expiry.
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  }
}

/** A valid access token, refreshing if the current one is close to expiry. */
export async function accessToken(): Promise<string> {
  if (!session) throw new Error('Not signed in to your ouRGeo account.')
  if (Date.now() < session.expiresAt) return session.accessToken
  session = await tokenRequest('refresh_token', { refresh_token: session.refreshToken })
  await saveRefreshToken(session.refreshToken)
  return session.accessToken
}

/**
 * Bring back a session from the keychain, if there is one.
 *
 * Returns whether there is now a live session. A refresh token that no longer
 * works is CLEARED rather than kept: a dead one makes every later attempt fail
 * identically, and being offered sign-in is better than a recurring error.
 */
export async function restoreSession(): Promise<boolean> {
  if (session) return true
  const refresh = await loadRefreshToken()
  if (!refresh) return false
  try {
    session = await tokenRequest('refresh_token', { refresh_token: refresh })
    await saveRefreshToken(session.refreshToken)
    return true
  } catch {
    session = null
    await saveRefreshToken(null)
    return false
  }
}

export async function signOut(): Promise<void> {
  session = null
  await saveRefreshToken(null)
}

/** The loopback URI an email magic link must be sent to. */
export function redirectUri(): string {
  return `http://127.0.0.1:${LOOPBACK_PORTS[0]}/callback`
}

// ── Loopback redirect ───────────────────────────────────────────────────────

function replyPage(title: string, detail: string): string {
  // Deliberately self-contained and offline: this renders after the browser has
  // left ourgeo.dev, and a page that tried to load assets would flash broken.
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>
 body{background:#0f1117;color:#e6edf3;font:15px/1.6 system-ui,sans-serif;
      display:grid;place-items:center;height:100vh;margin:0}
 .box{max-width:26rem;text-align:center;padding:2rem}
 h1{font-size:1.1rem;margin:0 0 .5rem;color:#4493f8}
 p{margin:0;color:#8b949e}
</style>
<div class="box"><h1>${title}</h1><p>${detail}</p></div>`
}

interface Loopback {
  port: number
  redirectUri: string
  /** Resolves with the PKCE auth code the browser was redirected with. */
  code: Promise<string>
  close(): void
}

/**
 * Listen on the first free loopback port for Supabase's redirect.
 *
 * Bound to 127.0.0.1 rather than 0.0.0.0 so nothing off this machine can reach
 * it, and torn down the moment a code arrives.
 */
async function startLoopback(timeoutMs = 5 * 60_000): Promise<Loopback> {
  let server: Server | null = null
  let port = 0

  for (const candidate of LOOPBACK_PORTS) {
    try {
      server = await new Promise<Server>((resolve, reject) => {
        const s = createServer()
        s.once('error', reject)
        s.listen(candidate, '127.0.0.1', () => resolve(s))
      })
      port = candidate
      break
    } catch {
      server = null
    }
  }
  if (!server) {
    throw new Error(
      `Could not open a local port for sign-in (tried ${LOOPBACK_PORTS.join(', ')}). ` +
      'Close whatever is using them and try again.'
    )
  }

  const listening = server
  let settle: ((code: string) => void) | null = null
  let fail: ((e: Error) => void) | null = null
  const code = new Promise<string>((resolve, reject) => { settle = resolve; fail = reject })

  const timer = setTimeout(() => {
    fail?.(new Error('Sign-in timed out.'))
    listening.close()
  }, timeoutMs)

  listening.on('request', (req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
    const got = url.searchParams.get('code')
    const err = url.searchParams.get('error_description') ?? url.searchParams.get('error')

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    if (got) {
      res.end(replyPage('Signed in', 'You can close this tab and return to ouRGeo.'))
      clearTimeout(timer)
      settle?.(got)
      listening.close()
    } else if (err) {
      res.end(replyPage('Sign-in failed', err))
      clearTimeout(timer)
      fail?.(new Error(err))
      listening.close()
    } else {
      // Supabase can deliver the code in the URL fragment, which never reaches
      // the server. Bounce it back as a query string from the page itself.
      res.end(`<!doctype html><meta charset="utf-8"><script>
        var h = location.hash.slice(1);
        if (h) location.replace(location.pathname + '?' + h);
        else document.body.textContent = 'Missing sign-in code.';
      </script>${replyPage('Finishing sign-in…', 'One moment.')}`)
    }
  })

  return {
    port,
    redirectUri: `http://127.0.0.1:${port}/callback`,
    code,
    close: () => { clearTimeout(timer); listening.close() },
  }
}

/** Run the whole PKCE flow and leave a live session behind. */
export async function signIn(provider: Provider, email?: string): Promise<void> {
  const { verifier, challenge } = makePkce()
  const loop = await startLoopback()
  try {
    if (provider === 'email') {
      const address = (email ?? '').trim()
      if (!address) throw new Error('Enter the email address of your ouRGeo account.')
      // Magic link rather than a password: the app never handles one, and the
      // emailed link carries the same PKCE code back to the loopback.
      const res = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: address,
          code_challenge: challenge,
          code_challenge_method: 's256',
          create_user: false,
        }),
      })
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as TokenResponse
        throw new Error(d.error_description || d.msg || 'Could not send the sign-in link.')
      }
    } else {
      const url = new URL(`${SUPABASE_URL}/auth/v1/authorize`)
      url.searchParams.set('provider', provider)
      url.searchParams.set('redirect_to', loop.redirectUri)
      url.searchParams.set('code_challenge', challenge)
      url.searchParams.set('code_challenge_method', 's256')
      await shell.openExternal(url.toString())
    }

    const code = await loop.code
    session = await tokenRequest('pkce', { auth_code: code, code_verifier: verifier })
    await saveRefreshToken(session.refreshToken)
  } finally {
    loop.close()
  }
}

// ── PostgREST ───────────────────────────────────────────────────────────────

/**
 * Turn a Postgres refusal into a sentence.
 *
 * Every gate on ourgeo.dev — trust level, quota, category role, who may
 * approve a plugin — is enforced by a trigger or an RLS policy, so its refusal
 * IS the user-facing message. The schema writes them as sentences for exactly
 * this reason; what must never reach the user is the raw error code around
 * them.
 *
 * `subject` names what refused. It is a parameter rather than the word "forum"
 * because this function moved here to be shared, and a failed plugin install
 * that blames the forum sends the user to look in the wrong place.
 */
export function friendly(message: string, status: number, subject = 'ourgeo.dev'): string {
  const m = String(message || '')
  if (/row-level security|violates row-level/i.test(m)) {
    return `${cap(subject)} refused that: your account may not do it yet.`
  }
  if (status === 401 || status === 403) return 'Your ourgeo.dev sign-in has expired. Sign in again.'

  // PostgREST's answer when a function or table is not in its schema cache.
  // It reads as a developer's message — "Could not find the function
  // public.plugin_catalogue(p_category, p_limit, …) in the schema cache" — and
  // for a user it means one thing: this copy of ouRGeo is asking ourgeo.dev for
  // something that is not there yet. Almost always because the app updated
  // first.
  if (/schema cache|does not exist|PGRST\d+/i.test(m) && status >= 400 && status < 500) {
    return (
      `${cap(subject)} does not have what this version of ouRGeo asked for. ` +
      'That usually means ouRGeo updated ahead of ourgeo.dev — try again later, and report it ' +
      'on the forum if it persists.'
    )
  }
  // Trigger messages (trust level, quota, per-post cap) arrive already written
  // for a person — pass them through untouched.
  return m || `${cap(subject)} returned an error (${status}).`
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export interface RestOptions {
  method?: string
  body?: unknown
  headers?: Record<string, string>
  /**
   * Whether a signed-in user is required.
   *
   * `'required'` (the default) throws when signed out — the old behaviour, and
   * right for anything that writes.
   *
   * `'optional'` sends the bearer only when there is a session. Browsing the
   * plugin store works signed out, but a signed-in reader must still get their
   * own answer: whether they have installed a plugin, whether it is theirs,
   * whether they may review it. There is deliberately no third `'anon'` mode —
   * nothing has a reason to hide a session it already has, and a mode with no
   * caller is a guess about the future.
   */
  auth?: 'required' | 'optional'
  /** What to name in an error message. */
  subject?: string
}

export async function rest<T>(path: string, init: RestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    apikey: SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
    ...init.headers,
  }

  if (init.auth === 'optional') {
    if (session) headers.Authorization = `Bearer ${await accessToken()}`
  } else {
    headers.Authorization = `Bearer ${await accessToken()}`
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    throw new Error(friendly(data?.message ?? data?.error ?? text, res.status, init.subject))
  }
  return data as T
}

// ── Storage ─────────────────────────────────────────────────────────────────
//
// Hand-rolled rather than supabase-js, for the same reason the rest of this
// module is: the app carries two runtime dependencies and each is a paragraph
// in CLAUDE.md. These are three HTTP calls.

/** Upload one object. The caller owns the path convention. */
export async function storageUpload(
  bucket: string, path: string, bytes: Uint8Array, mime: string, subject?: string,
): Promise<void> {
  const token = await accessToken()
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': mime,
      'cache-control': '31536000',
    },
    body: Buffer.from(bytes),
  })
  if (!res.ok) throw new Error(friendly(await res.text(), res.status, subject))
}

/** Remove one object. Best-effort by design at every call site so far. */
export async function storageDelete(bucket: string, path: string): Promise<void> {
  const token = await accessToken()
  await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
    method: 'DELETE',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  })
}

/**
 * Download one object from a PRIVATE bucket, with the user's own JWT.
 *
 * That is the whole mechanism behind "anonymous browsing works, anonymous
 * download does not" — a storage RLS SELECT policy decides, not this code and
 * not the renderer. See `can_download_bundle()` in the site's
 * db/schema-plugins.sql.
 */
export async function storageDownload(
  bucket: string, path: string, subject?: string,
): Promise<Buffer> {
  const token = await accessToken()
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(friendly(await res.text(), res.status, subject))
  return Buffer.from(await res.arrayBuffer())
}

/** The CDN URL of an object in a PUBLIC bucket. */
export function publicStorageUrl(bucket: string, path: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`
}

// ── Profile ─────────────────────────────────────────────────────────────────

/** Who is signed in, in the fields both features need. */
export interface AccountProfile {
  id: string
  username: string
  displayName: string
  role: string
  bannedUntil: string | null
}

export async function accountProfile(): Promise<AccountProfile> {
  const rows = await rest<Record<string, unknown>[]>(
    'profiles?select=id,username,display_name,role,banned_until&limit=1'
  )
  const p = rows?.[0]
  if (!p) throw new Error('Your ourgeo.dev profile could not be loaded.')
  return {
    id: String(p.id),
    username: String(p.username ?? ''),
    displayName: String(p.display_name ?? p.username ?? ''),
    role: String(p.role ?? 'user'),
    bannedUntil: (p.banned_until as string | null) ?? null,
  }
}

export const ROLE_RANK: Record<string, number> = { user: 0, moderator: 1, admin: 2 }

export function isStaff(role: string): boolean {
  return (ROLE_RANK[role] ?? 0) >= ROLE_RANK.moderator
}
