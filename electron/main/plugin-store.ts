import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { app, type IpcMain } from 'electron'
import {
  accountProfile, hasStoredSession, isSignedIn, isStaff, publicStorageUrl, rest,
  restoreSession, storageDelete, storageDownload, storageUpload,
} from './ourgeo-account'
import {
  distStageDir, installStoreArchive, DIST_NAME, SOURCE_NAME, type BuiltPackage,
} from './plugins'
import type { StoreOrigin } from '../../src/lib/plugins/store-origin'

// The plugin store, from the app's side.
//
// Browsing, installing, reviewing and submitting, all against ourgeo.dev's
// Supabase. It lives in the main process for the same reason `forum.ts` does:
// the access token never reaches the renderer, so the renderer can only ask for
// the operations below.
//
// ── Two buckets, and why installing needs a sign-in ────────────────────────
//
// `plugin-media` is public — a store you cannot see is not a store, so browsing
// works signed out.
//
// `plugin-bundles` is PRIVATE, and holds both the distributable and the source
// archive a moderator reads. That is the only part of "protect the author's
// code" that is more than a locked door in ouRGeo's own interface: a public
// bucket would put every bundle behind a URL the catalogue itself hands out.
// The consequence is a sign-in wall on Install, and it is enforced by a storage
// RLS policy (`can_download_bundle()`), not by anything here.
//
// What ships is minified. That is obfuscation, not encryption, and nothing in
// this file or in the UI should say otherwise.

const SUBJECT = 'the plugin store'
const BUNDLES = 'plugin-bundles'
const MEDIA = 'plugin-media'

const PAGE_URL = 'https://ourgeo.dev/plugin.html?slug='

// ── Shapes the renderer sees ────────────────────────────────────────────────

export interface StoreListing {
  slug: string
  name: string
  summary: string
  category: string
  tags: string[]
  installCount: number
  ratingAvg: number | null
  ratingCount: number
  publishedAt: string
  updatedAt: string
  author: string
  authorAvatar: string | null
  version: string
  ourgeoVersion: string | null
  hasCode: boolean
  permissions: string[]
  /** Public CDN url of the first screenshot, or null. */
  iconUrl: string | null
}

export interface StoreCategory {
  slug: string
  name: string
  description: string
  icon: string
}

/** What `plugin_updates()` says about one installed plugin. */
export interface StoreUpdate {
  slug: string
  latestVersion: string | null
  latestId: string | null
  ourgeoVersion: string | null
  changelog: string | null
  /** The status of the version the user HAS. 'revoked' is why this exists. */
  installedStatus: string | null
}

function mapListing(r: Record<string, unknown>): StoreListing {
  const icon = r.icon_path ? String(r.icon_path) : null
  return {
    slug: String(r.slug),
    name: String(r.name),
    summary: String(r.summary ?? ''),
    category: String(r.category ?? 'other'),
    tags: (r.tags as string[]) ?? [],
    installCount: Number(r.install_count ?? 0),
    ratingAvg: r.rating_avg == null ? null : Number(r.rating_avg),
    ratingCount: Number(r.rating_count ?? 0),
    publishedAt: String(r.published_at ?? ''),
    updatedAt: String(r.updated_at ?? ''),
    author: String(r.author ?? ''),
    authorAvatar: r.author_avatar ? String(r.author_avatar) : null,
    version: String(r.version ?? ''),
    ourgeoVersion: r.ourgeo_version ? String(r.ourgeo_version) : null,
    hasCode: Boolean(r.has_code),
    permissions: (r.permissions as string[]) ?? [],
    iconUrl: icon ? publicStorageUrl(MEDIA, icon) : null,
  }
}

// ── IPC ─────────────────────────────────────────────────────────────────────

export function registerPluginStoreHandlers(ipcMain: IpcMain): void {
  /**
   * Is there a session on this machine — without asking the network?
   *
   * The store dialog has to choose between "Install" and "Sign in to install"
   * before it draws anything, and a full restore is a refresh grant plus a
   * profile fetch. `hasStoredToken` is a disk check; `profile` is filled only
   * when a session is already live in this process.
   */
  ipcMain.handle('account:status', async () => ({
    hasStoredToken: hasStoredSession(),
    signedIn: isSignedIn(),
    profile: isSignedIn() ? await accountProfile().catch(() => null) : null,
  }))

  ipcMain.handle('store:categories', async (): Promise<StoreCategory[]> => {
    const rows = await rest<Record<string, unknown>[]>(
      'plugin_categories?select=slug,name,description,icon,sort_order&order=sort_order',
      { auth: 'optional', subject: SUBJECT },
    )
    return (rows ?? []).map((c) => ({
      slug: String(c.slug),
      name: String(c.name),
      description: String(c.description ?? ''),
      icon: String(c.icon ?? '🧩'),
    }))
  })

  ipcMain.handle(
    'store:catalogue',
    async (_e, req: {
      query?: string; category?: string; tag?: string
      sort?: string; limit?: number; offset?: number
    }): Promise<StoreListing[]> => {
      const rows = await rest<Record<string, unknown>[]>('rpc/plugin_catalogue', {
        method: 'POST',
        auth: 'optional',
        subject: SUBJECT,
        body: {
          p_query: req.query || null,
          p_category: req.category || null,
          p_tag: req.tag || null,
          p_sort: req.sort || 'popular',
          p_limit: req.limit ?? 24,
          p_offset: req.offset ?? 0,
        },
      })
      return (rows ?? []).map(mapListing)
    },
  )

  /**
   * One plugin, everything a detail pane needs, in one call.
   *
   * `auth: 'optional'`, and that matters: signed out it answers with the public
   * facts, signed in it also says whether this account has installed it,
   * whether it is theirs and whether they may review it. Those are per-reader
   * answers, so a cached anonymous copy would be wrong for everyone.
   */
  ipcMain.handle('store:detail', async (_e, slug: string) => {
    const data = await rest<Record<string, unknown> | null>('rpc/plugin_detail', {
      method: 'POST', auth: 'optional', subject: SUBJECT, body: { p_slug: slug },
    })
    if (!data) return null
    const media = (data.media as { path: string; alt: string | null }[] | undefined) ?? []
    return {
      ...data,
      pageUrl: `${PAGE_URL}${encodeURIComponent(slug)}`,
      media: media.map((m) => ({ ...m, url: publicStorageUrl(MEDIA, m.path) })),
    }
  })

  ipcMain.handle(
    'store:updates',
    async (_e, installed: { slug: string; version: string }[]): Promise<StoreUpdate[]> => {
      if (installed.length === 0) return []
      // One call, not one per plugin. A user with a dozen store plugins would
      // otherwise open a dozen requests on every launch.
      const rows = await rest<Record<string, unknown>[]>('rpc/plugin_updates', {
        method: 'POST',
        auth: 'optional',
        subject: SUBJECT,
        body: {
          p_slugs: installed.map((i) => i.slug),
          p_versions: installed.map((i) => i.version),
        },
      })
      return (rows ?? []).map((r) => ({
        slug: String(r.slug),
        latestVersion: r.latest_version ? String(r.latest_version) : null,
        latestId: r.latest_id ? String(r.latest_id) : null,
        ourgeoVersion: r.ourgeo_version ? String(r.ourgeo_version) : null,
        changelog: r.changelog ? String(r.changelog) : null,
        installedStatus: r.installed_status ? String(r.installed_status) : null,
      }))
    },
  )

  /**
   * Download and install one version.
   *
   * The bytes are checked against the length and hash the store recorded
   * BEFORE anything is unpacked. That is cheap, and it is the only thing
   * standing between "the bucket was misconfigured" and "we installed it
   * anyway" — a mismatch means the file is not the one a moderator approved,
   * whatever the reason.
   *
   * A moderator may install a version that is still pending: otherwise testing
   * a submission means downloading a file by hand, and a review gate nobody can
   * reach is a review gate nobody uses.
   */
  ipcMain.handle(
    'store:install',
    async (_e, req: { slug: string; versionId: string }): Promise<StoreOrigin> => {
      if (!isSignedIn() && !(await restoreSession())) {
        throw new Error(
          'Installing from the plugin store needs your ourgeo.dev account — the bundles are not public. ' +
          'Sign in and try again.'
        )
      }

      const rows = await rest<Record<string, unknown>[]>(
        `plugin_versions?select=id,plugin_slug,version,storage_path,bytes,sha256,status` +
        `&id=eq.${encodeURIComponent(req.versionId)}&limit=1`,
        { subject: SUBJECT },
      )
      const v = rows?.[0]
      if (!v) throw new Error('That plugin version is no longer in the store.')
      if (String(v.plugin_slug) !== req.slug) {
        throw new Error('That version belongs to a different plugin. Nothing was installed.')
      }

      const bytes = await storageDownload(BUNDLES, String(v.storage_path), SUBJECT)

      if (bytes.byteLength !== Number(v.bytes)) {
        throw new Error(
          `The download is ${bytes.byteLength} bytes but the store lists ${v.bytes}. ` +
          'Nothing was installed — try again, and report it if it keeps happening.'
        )
      }
      const got = createHash('sha256').update(bytes).digest('hex')
      if (got !== String(v.sha256)) {
        throw new Error(
          'The download does not match the checksum the store recorded, so it is not the file that ' +
          'was reviewed. Nothing was installed — please report this.'
        )
      }

      const tmpDir = join(app.getPath('temp'), `ourgeo-plugin-${randomUUID()}`)
      await mkdir(tmpDir, { recursive: true })
      const tmp = join(tmpDir, 'download.ourgeoplugin')
      try {
        await writeFile(tmp, bytes)

        const detail = await rest<Record<string, unknown> | null>('rpc/plugin_detail', {
          method: 'POST', auth: 'optional', subject: SUBJECT, body: { p_slug: req.slug },
        })
        const origin: StoreOrigin = {
          slug: req.slug,
          versionId: String(v.id),
          version: String(v.version),
          sha256: got,
          installedAt: new Date().toISOString(),
          name: String(detail?.name ?? req.slug),
          author: (detail?.author as { displayName?: string } | undefined)?.displayName,
        }

        await installStoreArchive(tmp, origin)

        // After the install, and never in its way: a count is not worth failing
        // an install over, and the plugin is already on disk by now.
        await rest('rpc/record_plugin_install', {
          method: 'POST', subject: SUBJECT,
          body: { p_slug: req.slug, p_version: origin.version },
        }).catch(() => undefined)

        return origin
      } finally {
        await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
      }
    },
  )

  // ── Reviews ──────────────────────────────────────────────────────────────

  ipcMain.handle('store:reviews', async (_e, slug: string) => {
    const rows = await rest<Record<string, unknown>[]>(
      `plugin_reviews?select=rating,body,created_at,updated_at,author_id` +
      `&plugin_slug=eq.${encodeURIComponent(slug)}&is_deleted=is.false&order=updated_at.desc&limit=50`,
      { auth: 'optional', subject: SUBJECT },
    )
    return rows ?? []
  })

  ipcMain.handle(
    'store:writeReview',
    async (_e, req: { slug: string; rating: number; body?: string }): Promise<void> => {
      const me = await accountProfile()
      await rest('plugin_reviews', {
        method: 'POST',
        subject: SUBJECT,
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: {
          plugin_slug: req.slug,
          author_id: me.id,
          rating: req.rating,
          body: (req.body ?? '').slice(0, 4000) || null,
          is_deleted: false,
          updated_at: new Date().toISOString(),
        },
      })
    },
  )

  ipcMain.handle('store:deleteReview', async (_e, slug: string): Promise<void> => {
    const me = await accountProfile()
    await rest(
      `plugin_reviews?plugin_slug=eq.${encodeURIComponent(slug)}&author_id=eq.${me.id}`,
      { method: 'DELETE', subject: SUBJECT },
    )
  })

  // ── Submitting ───────────────────────────────────────────────────────────

  ipcMain.handle('store:mine', async () => {
    return await rest<Record<string, unknown>[]>('rpc/my_plugins', {
      method: 'POST', subject: SUBJECT, body: {},
    })
  })

  /**
   * Upload a built submission and record it as pending.
   *
   * The archives go up BEFORE the row, the same order forum figures use: a
   * submission whose bytes are refused then fails with nothing recorded, where
   * the other order would leave a version row pointing at an object that is not
   * there. If the row is refused, both objects are removed again.
   */
  ipcMain.handle(
    'store:submit',
    async (_e, req: {
      pluginId: string
      built: BuiltPackage
      manifest: Record<string, unknown>
      meta: {
        name: string; summary: string; description?: string; category: string
        tags?: string[]; homepage?: string; repository?: string; license?: string
        changelog?: string
      }
    }): Promise<{ versionId: string }> => {
      const me = await accountProfile()
      const stage = distStageDir(req.pluginId)
      const distBytes = await readFile(join(stage, DIST_NAME))
      const sourceBytes = await readFile(join(stage, SOURCE_NAME))

      const versionId = randomUUID()
      // Owner-first, so the storage insert policy is a string comparison
      // rather than a join.
      const distPath = `${me.id}/${versionId}.ourgeoplugin`
      const sourcePath = `${me.id}/${versionId}.source.zip`

      await storageUpload(BUNDLES, distPath, distBytes, 'application/zip', SUBJECT)
      try {
        await storageUpload(BUNDLES, sourcePath, sourceBytes, 'application/zip', SUBJECT)
      } catch (e) {
        await storageDelete(BUNDLES, distPath).catch(() => undefined)
        throw e
      }

      try {
        const id = await rest<string>('rpc/submit_plugin_version', {
          method: 'POST',
          subject: SUBJECT,
          body: {
            p_slug: String(req.manifest.id),
            p_version: String(req.manifest.version),
            p_manifest: req.manifest,
            p_storage: distPath,
            p_source: sourcePath,
            p_bytes: req.built.distBytes,
            p_sha256: req.built.sha256,
            p_name: req.meta.name,
            p_summary: req.meta.summary,
            p_description: req.meta.description ?? null,
            p_category: req.meta.category,
            p_tags: req.meta.tags ?? [],
            p_homepage: req.meta.homepage ?? null,
            p_repository: req.meta.repository ?? null,
            p_license: req.meta.license ?? null,
            p_changelog: req.meta.changelog ?? null,
          },
        })
        return { versionId: String(id) }
      } catch (e) {
        await storageDelete(BUNDLES, distPath).catch(() => undefined)
        await storageDelete(BUNDLES, sourcePath).catch(() => undefined)
        throw e
      }
    },
  )

  /**
   * The screenshots already on a plugin's store page.
   *
   * Read from the table rather than from `plugin_detail`, because that RPC
   * reports a screenshot's path but not its id, and an id is what deleting and
   * reordering need. `claimed` is the other half of the answer and the reason
   * this is one call: `plugin_media_insert` is gated on `plugin_is_mine`, so
   * until a first version has been submitted there is no plugin row to hang a
   * picture on and an upload cannot succeed. The submit panel has to know that
   * BEFORE it offers the button, not after a refusal.
   */
  ipcMain.handle('store:media', async (_e, slug: string): Promise<{
    claimed: boolean
    mine: boolean
    items: {
      id: string; url: string; path: string; alt: string | null
      bytes: number; width: number; height: number; sortOrder: number
    }[]
  }> => {
    // With a stored-but-not-yet-restored session this would go out anonymously,
    // and `plugins_read` hides an unpublished plugin from anyone but its owner —
    // so an author's own pending submission would come back as "not in the store
    // yet", and their screenshots would queue for a submission that has already
    // happened. Restore first, then ask.
    if (!isSignedIn()) await restoreSession().catch(() => false)
    if (!isSignedIn() && hasStoredSession()) {
      // A token on disk that will not restore is an expired sign-in, and going
      // on anonymously would answer "not in the store yet" for a plugin that is
      // — the one wrong answer this call must never give.
      throw new Error('Your ourgeo.dev sign-in has expired. Sign in again to manage screenshots.')
    }
    const me = await accountProfile().catch(() => null)
    const owners = await rest<Record<string, unknown>[]>(
      `plugins?select=slug,owner_id&slug=eq.${encodeURIComponent(slug)}&limit=1`,
      { auth: 'optional', subject: SUBJECT },
    )
    const owner = owners?.[0]
    if (!owner) return { claimed: false, mine: false, items: [] }

    const rows = await rest<Record<string, unknown>[]>(
      'plugin_media?select=id,storage_path,alt_text,bytes,width,height,sort_order' +
      `&plugin_slug=eq.${encodeURIComponent(slug)}&order=sort_order,created_at`,
      { auth: 'optional', subject: SUBJECT },
    )
    return {
      claimed: true,
      mine: !!me && String(owner.owner_id) === me.id,
      items: (rows ?? []).map((m) => ({
        id: String(m.id),
        path: String(m.storage_path),
        url: publicStorageUrl(MEDIA, String(m.storage_path)),
        alt: m.alt_text ? String(m.alt_text) : null,
        bytes: Number(m.bytes ?? 0),
        width: Number(m.width ?? 0),
        height: Number(m.height ?? 0),
        sortOrder: Number(m.sort_order ?? 0),
      })),
    }
  })

  /**
   * Remove one screenshot, for good.
   *
   * The ROW goes first and the object second, which is the opposite order to
   * uploading and for the same reason it is right both times: the failure that
   * must not happen is a row pointing at bytes that are gone, because that is a
   * broken image on a public page. An object with no row is invisible — it
   * costs the author a slot against the 200-object storage policy and nothing
   * else — so it is the safe half to leave behind if the second call fails.
   */
  ipcMain.handle(
    'store:deleteMedia',
    async (_e, req: { id: string; path: string }): Promise<void> => {
      await rest(`plugin_media?id=eq.${encodeURIComponent(req.id)}`, {
        method: 'DELETE', subject: SUBJECT,
      })
      await storageDelete(MEDIA, req.path).catch(() => undefined)
    },
  )

  /**
   * Re-describe or re-order one screenshot.
   *
   * Order matters more than it looks: the catalogue card takes its picture from
   * the first screenshot (`icon_path`), so "make this the cover" is a sort
   * order write and nothing else.
   */
  ipcMain.handle(
    'store:updateMedia',
    async (_e, req: { id: string; alt?: string; sortOrder?: number }): Promise<void> => {
      const body: Record<string, unknown> = {}
      if (req.alt !== undefined) body.alt_text = req.alt.slice(0, 300) || null
      if (req.sortOrder !== undefined) body.sort_order = req.sortOrder
      if (Object.keys(body).length === 0) return
      await rest(`plugin_media?id=eq.${encodeURIComponent(req.id)}`, {
        method: 'PATCH', subject: SUBJECT, body,
      })
    },
  )

  /** Upload one screenshot. Public bucket, so the URL is the answer. */
  ipcMain.handle(
    'store:uploadMedia',
    async (_e, req: {
      slug: string; bytes: Uint8Array; mime: string
      width: number; height: number; alt?: string; sortOrder?: number
    }) => {
      const me = await accountProfile()
      const id = randomUUID()
      const ext = req.mime === 'image/webp' ? 'webp' : req.mime === 'image/png' ? 'png' : 'jpg'
      const path = `${me.id}/${req.slug}/${id}.${ext}`

      await storageUpload(MEDIA, path, req.bytes, req.mime, SUBJECT)
      try {
        await rest('plugin_media', {
          method: 'POST',
          subject: SUBJECT,
          body: {
            id,
            plugin_slug: req.slug,
            owner_id: me.id,
            storage_path: path,
            mime_type: req.mime,
            bytes: req.bytes.byteLength,
            width: req.width,
            height: req.height,
            alt_text: (req.alt ?? '').slice(0, 300) || null,
            sort_order: req.sortOrder ?? 0,
          },
        })
      } catch (e) {
        await storageDelete(MEDIA, path).catch(() => undefined)
        // `plugin_media_insert` is gated on `plugin_is_mine`, and the row that
        // makes that true is written by the first submission. Left alone, the
        // refusal arrives as friendly()'s generic "your account may not do it
        // yet", which sends the author to check their trust level for a problem
        // that is about ordering.
        const claimed = await rest<Record<string, unknown>[]>(
          `plugins?select=slug&slug=eq.${encodeURIComponent(req.slug)}&limit=1`,
          { auth: 'optional', subject: SUBJECT },
        ).catch(() => null)
        if (claimed && claimed.length === 0) {
          throw new Error(
            'Screenshots attach to a plugin the store already knows about, and this one has ' +
            'not been submitted yet. Submit this version first — ouRGeo will then upload the ' +
            'screenshots you have picked.'
          )
        }
        throw e
      }
      return { id, path, url: publicStorageUrl(MEDIA, path) }
    },
  )

  // ── Moderation ───────────────────────────────────────────────────────────
  //
  // Reviewing happens on ourgeo.dev, not here — a staff tool in every user's
  // binary is a surface with no reason to exist on most machines. What the app
  // does carry is the one thing the website cannot do: install a pending
  // version so a moderator can actually run it.

  ipcMain.handle('store:isModerator', async (): Promise<boolean> => {
    if (!isSignedIn() && !(await restoreSession())) return false
    const me = await accountProfile().catch(() => null)
    return me ? isStaff(me.role) : false
  })
}
