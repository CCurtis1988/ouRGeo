import { randomUUID } from 'node:crypto'
import { type IpcMain } from 'electron'
import {
  accountProfile, isSignedIn, publicStorageUrl, redirectUri, rest, restoreSession,
  signIn, signOut, storageDelete, storageUpload, ROLE_RANK, type Provider,
} from './ourgeo-account'

// Publishing to the ouRGeo forum (ourgeo.dev/forum.html).
//
// The forum is a static site on Supabase: posting a discussion is an insert
// into `threads`, and figures go to the `post-images` storage bucket with a row
// in `post_attachments`, bound to the thread afterwards by link_attachments().
// There is no bespoke API, so this speaks PostgREST.
//
// The account, the PKCE sign-in and the HTTP live in `ourgeo-account.ts`,
// because the plugin store needs the same session and the account IS one
// account — two modules each holding their own would mean signing in twice for
// two features of one website. What is left here is the forum's own six
// operations, and they behave exactly as they did before that split.

const THREAD_URL = 'https://ourgeo.dev/forum-thread.html?id='

const SUBJECT = 'the forum'

/** Mirrors IMAGE_RULES in the site's assets/js/image-upload.js. */
export const FORUM_LIMITS = {
  titleMax: 140,
  bodyMax: 12000,
  imagesPerPost: 10,
  imageBytes: 400_000,
  imageEdge: 1600,
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

async function fetchProfile(): Promise<ForumProfile> {
  const me = await accountProfile()

  // attachment_usage() returns the trust level and the quota together, which
  // saves a second round trip and keeps the number the DATABASE believes.
  let level = 0
  let bytesUsed = 0
  let quota = 0
  try {
    const usage = await rest<{ bytes_used: number; quota: number; level: number }[] | {
      bytes_used: number; quota: number; level: number
    }>('rpc/attachment_usage', { method: 'POST', body: {}, subject: SUBJECT })
    const u = Array.isArray(usage) ? usage[0] : usage
    if (u) { level = Number(u.level ?? 0); bytesUsed = Number(u.bytes_used ?? 0); quota = Number(u.quota ?? 0) }
  } catch { /* a usage failure must not block sign-in */ }

  return { ...me, trustLevel: level, bytesUsed, quota }
}

// ── IPC ─────────────────────────────────────────────────────────────────────

export function registerForumHandlers(ipcMain: IpcMain): void {
  /**
   * Restore a previous session, if the keychain has one.
   *
   * One deliberate difference from the version before the account module was
   * split out: a profile fetch that fails AFTER a successful refresh no longer
   * throws the stored token away. The old code caught both in one branch, so a
   * network blip on the second round trip signed the user out for good and the
   * next launch offered them sign-in with no explanation. A refresh that
   * succeeded means the credential is fine; `restoreSession()` is what clears
   * one that is not.
   */
  ipcMain.handle('forum:restore', async (): Promise<ForumProfile | null> => {
    if (isSignedIn()) return await fetchProfile().catch(() => null)
    if (!(await restoreSession())) return null
    return await fetchProfile().catch(() => null)
  })

  ipcMain.handle(
    'forum:signIn',
    async (_e, req: { provider: Provider; email?: string }): Promise<ForumProfile> => {
      await signIn(req.provider, req.email)
      return await fetchProfile()
    }
  )

  /** The loopback URI an email magic link must be sent to. */
  ipcMain.handle('forum:redirectUri', () => redirectUri())

  ipcMain.handle('forum:signOut', async (): Promise<void> => {
    await signOut()
  })

  /**
   * Categories this account may actually post in.
   *
   * Filtered by role rather than shown-and-then-refused, mirroring what
   * forum-new.html does on the website.
   */
  ipcMain.handle('forum:postableCategories', async (): Promise<ForumCategory[]> => {
    const [rows, me] = await Promise.all([
      rest<Record<string, unknown>[]>(
        'categories?select=slug,name,description,icon,sort_order,min_role_to_post' +
        '&is_archived=eq.false&order=sort_order',
        { subject: SUBJECT },
      ),
      fetchProfile(),
    ])
    const mine = ROLE_RANK[me.role] ?? 0
    return (rows ?? [])
      .map((c) => ({
        slug: String(c.slug),
        name: String(c.name),
        description: String(c.description ?? ''),
        icon: String(c.icon ?? '📁'),
        minRoleToPost: String(c.min_role_to_post ?? 'user'),
      }))
      .filter((c) => mine >= (ROLE_RANK[c.minRoleToPost] ?? 0))
  })

  /**
   * Upload one figure.
   *
   * The object is written BEFORE the row that describes it, so the byte quota
   * cannot be checked in a storage policy — the row's trigger is what enforces
   * it. If the row is refused, the object is removed again so the user is not
   * charged quota for bytes nothing references. That is the same ordering the
   * website's image-upload.js uses.
   */
  ipcMain.handle(
    'forum:uploadImage',
    async (_e, req: { bytes: Uint8Array; mime: string; width: number; height: number; alt?: string }) => {
      const me = await fetchProfile()
      const id = randomUUID()
      const ext = req.mime === 'image/webp' ? 'webp' : req.mime === 'image/png' ? 'png' : 'jpg'
      // First path segment is the owner id — that is what makes the storage
      // policies a string comparison instead of a join.
      const path = `${me.id}/${id}.${ext}`

      await storageUpload('post-images', path, req.bytes, req.mime, SUBJECT)

      try {
        await rest('post_attachments', {
          method: 'POST',
          subject: SUBJECT,
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
        await storageDelete('post-images', path).catch(() => {})
        throw e
      }

      return { id, url: publicStorageUrl('post-images', path) }
    }
  )

  ipcMain.handle(
    'forum:createThread',
    async (_e, req: { category: string; title: string; body: string; attachmentIds: string[] }) => {
      const me = await fetchProfile()
      const rows = await rest<{ id: number }[]>('threads', {
        method: 'POST',
        subject: SUBJECT,
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
            subject: SUBJECT,
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

// `forum:categories` used to sit here, listing every category rather than the
// postable ones. It was never bridged in the preload, so nothing could call it;
// `forum:postableCategories` is what the Publish dialog uses and is what the
// website's own composer shows. Removed rather than wired: a second listing
// with no caller is one more thing to keep in step for no reason.
