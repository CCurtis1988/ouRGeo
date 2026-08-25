import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage, shell, type IpcMain } from 'electron'

// Publishing to the ouRGeo forum (ourgeo.dev/forum.html).
//
// The forum is a static site on Supabase: posting a discussion is an insert
// into `threads`, and figures go to the `post-images` storage bucket with a row
// in `post_attachments`, bound to the thread afterwards by link_attachments().
// There is no bespoke API, so everything here speaks PostgREST and GoTrue.
//
// ALL of it lives in the main process on purpose. The access token never
// reaches the renderer, so a bug (or an injected script) in the UI cannot post
// as the user or read their credentials — the renderer can only ask for the
// specific operations below.
//
// Auth is PKCE with a loopback redirect, which is what lets one flow cover all
// three sign-in methods the forum offers:
//   * google / github → /auth/v1/authorize in the user's real browser
//   * email           → /auth/v1/otp, a magic link that lands on the same
//                       loopback
// In both cases the code_verifier stays in this process, so nothing that
// arrives over the loopback is useful to anyone else.

const SUPABASE_URL = 'https://tdtkuagfaiyasscnvaoh.supabase.co'
// Publishable by design — it identifies the project and grants nothing. Every
// table is behind RLS, enforced by Postgres. See the site's assets/js/config.js.
const SUPABASE_ANON_KEY = 'sb_publishable_OK5HP-0fKEAQypRsB0jHtA_bg3UZ9fT'

const THREAD_URL = 'https://ourgeo.dev/forum-thread.html?id='

/**
 * Ports tried in order for the OAuth redirect.
 *
 * Fixed rather than ephemeral because every one of them has to be listed in
 * Supabase → Authentication → URL Configuration → Redirect URLs; a random port
 * could not be allow-listed in advance.
 */
const LOOPBACK_PORTS = [8788, 8789, 8790]

/** Mirrors IMAGE_RULES in the site's assets/js/image-upload.js. */
export const FORUM_LIMITS = {
  titleMax: 140,
  bodyMax: 12000,
  imagesPerPost: 10,
  imageBytes: 400_000,
  imageEdge: 1600,
}

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
 * Unlike an API key, this token grants the ability to post as the user, so it
 * gets stronger treatment than the plaintext api-keys.json convention. When no
 * keyring is available (a bare Linux box), encryption is simply unavailable and
 * we keep nothing — the user signs in again next launch, which is a better
 * outcome than writing a posting credential to disk in the clear.
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
async function accessToken(): Promise<string> {
  if (!session) throw new Error('Not signed in to the ouRGeo forum.')
  if (Date.now() < session.expiresAt) return session.accessToken
  session = await tokenRequest('refresh_token', { refresh_token: session.refreshToken })
  await saveRefreshToken(session.refreshToken)
  return session.accessToken
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
    fail?.(new Error('Sign-in timed out. Nothing was published.'))
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

// ── PostgREST ───────────────────────────────────────────────────────────────

/**
 * Turn a Postgres refusal into a sentence.
 *
 * Every gate on the forum — trust level, quota, category role — is enforced by
 * a trigger or an RLS policy, so its refusal IS the user-facing message. The
 * schema writes them as sentences for exactly this reason; what must never
 * reach the user is the raw error code around them.
 */
function friendly(message: string, status: number): string {
  const m = String(message || '')
  if (/row-level security|violates row-level/i.test(m)) {
    return 'The forum refused that: your account may not post in this category yet.'
  }
  if (status === 401 || status === 403) return 'Your forum sign-in has expired. Sign in again.'
  // Trigger messages (trust level, quota, per-post cap) arrive already written
  // for a person — pass them through untouched.
  return m || `The forum returned an error (${status}).`
}

async function rest<T>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const token = await accessToken()
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: init.method ?? 'GET',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error(friendly(data?.message ?? data?.error ?? text, res.status))
  return data as T
}

// ── Public shapes ───────────────────────────────────────────────────────────

export interface ForumProfile {
  id: string
  username: string
  displayName: string
  role: string
  trustLevel: number
  /** Storage bytes used and allowed, from attachment_usage(). */
  bytesUsed: number
  quota: number
  bannedUntil: string | null
}

export interface ForumCategory {
  slug: string
  name: string
  description: string
  icon: string
  minRoleToPost: string
}

const ROLE_RANK: Record<string, number> = { user: 0, moderator: 1, admin: 2 }

async function fetchProfile(): Promise<ForumProfile> {
  const rows = await rest<Record<string, unknown>[]>(
    'profiles?select=id,username,display_name,role,banned_until&limit=1'
  )
  const p = rows?.[0]
  if (!p) throw new Error('Your forum profile could not be loaded.')

  // attachment_usage() returns the trust level and the quota together, which
  // saves a second round trip and keeps the number the DATABASE believes.
  let level = 0
  let bytesUsed = 0
  let quota = 0
  try {
    const usage = await rest<{ bytes_used: number; quota: number; level: number }[] | {
      bytes_used: number; quota: number; level: number
    }>('rpc/attachment_usage', { method: 'POST', body: {} })
    const u = Array.isArray(usage) ? usage[0] : usage
    if (u) { level = Number(u.level ?? 0); bytesUsed = Number(u.bytes_used ?? 0); quota = Number(u.quota ?? 0) }
  } catch { /* a usage failure must not block sign-in */ }

  return {
    id: String(p.id),
    username: String(p.username ?? ''),
    displayName: String(p.display_name ?? p.username ?? ''),
    role: String(p.role ?? 'user'),
    trustLevel: level,
    bytesUsed,
    quota,
    bannedUntil: (p.banned_until as string | null) ?? null,
  }
}

// ── IPC ─────────────────────────────────────────────────────────────────────

export function registerForumHandlers(ipcMain: IpcMain): void {
  /** Restore a previous session, if the keychain has one. */
  ipcMain.handle('forum:restore', async (): Promise<ForumProfile | null> => {
    if (session) return await fetchProfile().catch(() => null)
    const refresh = await loadRefreshToken()
    if (!refresh) return null
    try {
      session = await tokenRequest('refresh_token', { refresh_token: refresh })
      await saveRefreshToken(session.refreshToken)
      return await fetchProfile()
    } catch {
      // A refresh token that no longer works is worse than none: clear it so
      // the user is offered sign-in rather than a recurring error.
      session = null
      await saveRefreshToken(null)
      return null
    }
  })

  ipcMain.handle(
    'forum:signIn',
    async (_e, req: { provider: 'google' | 'github' | 'email'; email?: string }): Promise<ForumProfile> => {
      const { verifier, challenge } = makePkce()
      const loop = await startLoopback()
      try {
        if (req.provider === 'email') {
          const email = (req.email ?? '').trim()
          if (!email) throw new Error('Enter the email address of your forum account.')
          // Magic link rather than a password: the app never handles one, and
          // the emailed link carries the same PKCE code back to the loopback.
          const res = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
            method: 'POST',
            headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email,
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
          url.searchParams.set('provider', req.provider)
          url.searchParams.set('redirect_to', loop.redirectUri)
          url.searchParams.set('code_challenge', challenge)
          url.searchParams.set('code_challenge_method', 's256')
          await shell.openExternal(url.toString())
        }

        const code = await loop.code
        session = await tokenRequest('pkce', { auth_code: code, code_verifier: verifier })
        await saveRefreshToken(session.refreshToken)
        return await fetchProfile()
      } finally {
        loop.close()
      }
    }
  )

  /** The loopback URI an email magic link must be sent to. */
  ipcMain.handle('forum:redirectUri', () => `http://127.0.0.1:${LOOPBACK_PORTS[0]}/callback`)

  ipcMain.handle('forum:signOut', async (): Promise<void> => {
    session = null
    await saveRefreshToken(null)
  })

  ipcMain.handle('forum:categories', async (): Promise<ForumCategory[]> => {
    const rows = await rest<Record<string, unknown>[]>(
      'categories?select=slug,name,description,icon,sort_order,min_role_to_post' +
      '&is_archived=eq.false&order=sort_order'
    )
    return (rows ?? []).map((c) => ({
      slug: String(c.slug),
      name: String(c.name),
      description: String(c.description ?? ''),
      icon: String(c.icon ?? '📁'),
      minRoleToPost: String(c.min_role_to_post ?? 'user'),
    }))
  })

  /** Categories this account's role permits, mirroring forum-new.html. */
  ipcMain.handle('forum:postableCategories', async (): Promise<ForumCategory[]> => {
    const [cats, me] = await Promise.all([
      rest<Record<string, unknown>[]>(
        'categories?select=slug,name,description,icon,sort_order,min_role_to_post' +
        '&is_archived=eq.false&order=sort_order'
      ),
      fetchProfile(),
    ])
    const mine = ROLE_RANK[me.role] ?? 0
    return (cats ?? [])
      .filter((c) => mine >= (ROLE_RANK[String(c.min_role_to_post ?? 'user')] ?? 0))
      .map((c) => ({
        slug: String(c.slug),
        name: String(c.name),
        description: String(c.description ?? ''),
        icon: String(c.icon ?? '📁'),
        minRoleToPost: String(c.min_role_to_post ?? 'user'),
      }))
  })

  /**
   * Upload one already-transcoded figure.
   *
   * The renderer does the resize and re-encode (it has a canvas; this process
   * does not), and hands over the finished bytes. Storage first, then the
   * attachment row — and if the row is refused, the object is removed again so
   * the user is not charged quota for bytes nothing references. That is the
   * same ordering the website's image-upload.js uses.
   */
  ipcMain.handle(
    'forum:uploadImage',
    async (_e, req: { bytes: Uint8Array; mime: string; width: number; height: number; alt?: string }) => {
      const token = await accessToken()
      const me = await fetchProfile()
      const id = randomUUID()
      const ext = req.mime === 'image/webp' ? 'webp' : req.mime === 'image/png' ? 'png' : 'jpg'
      // First path segment is the owner id — that is what makes the storage
      // policies a string comparison instead of a join.
      const path = `${me.id}/${id}.${ext}`

      const up = await fetch(`${SUPABASE_URL}/storage/v1/object/post-images/${path}`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
          'Content-Type': req.mime,
          'cache-control': '31536000',
        },
        body: Buffer.from(req.bytes),
      })
      if (!up.ok) {
        const t = await up.text()
        throw new Error(friendly(t, up.status))
      }

      try {
        await rest('post_attachments', {
          method: 'POST',
          body: {
            id,
            owner_id: me.id,
            storage_path: path,
            mime_type: req.mime,
            bytes: req.bytes.byteLength,
            width: req.width,
            height: req.height,
            alt_text: (req.alt ?? '').slice(0, 300) || null,
          },
        })
      } catch (e) {
        await fetch(`${SUPABASE_URL}/storage/v1/object/post-images/${path}`, {
          method: 'DELETE',
          headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
        }).catch(() => {})
        throw e
      }

      return {
        id,
        url: `${SUPABASE_URL}/storage/v1/object/public/post-images/${path}`,
      }
    }
  )

  ipcMain.handle(
    'forum:createThread',
    async (_e, req: { category: string; title: string; body: string; attachmentIds: string[] }) => {
      const me = await fetchProfile()
      const rows = await rest<{ id: number }[]>('threads', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: {
          category_slug: req.category,
          author_id: me.id,
          title: req.title,
          body: req.body,
        },
      })
      const id = rows?.[0]?.id
      if (!id) throw new Error('The forum did not return a post id.')

      // Bind the figures. The thread exists either way, so a failure here is
      // reported rather than thrown — losing the images is not a reason to
      // pretend the post did not save.
      let imageError: string | null = null
      if (req.attachmentIds.length) {
        try {
          await rest('rpc/link_attachments', {
            method: 'POST',
            body: { p_ids: req.attachmentIds, p_target_type: 'thread', p_target_id: id },
          })
        } catch (e) {
          imageError = e instanceof Error ? e.message : String(e)
        }
      }

      return { id, url: `${THREAD_URL}${id}`, imageError }
    }
  )
}
