import React, { useCallback, useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  X, Search, Loader2, AlertCircle, Download, Check, Star, Puzzle, ExternalLink,
  RefreshCw, ShieldAlert, ArrowUpCircle,
} from 'lucide-react'
import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'
import { cn } from '@/lib/utils'
import * as store from '@/lib/plugin-store/client'
import { installFromStore, updateFromStore } from '@/lib/plugin-store/install'
import { ensureUpdateCheck } from '@/lib/plugin-store/updates'
import { usePluginStoreBrowser } from '@/store/pluginStore'
import { SORT_LABELS, type StoreDetail, type StoreListing, type StoreSort } from '@/lib/plugin-store/types'
import { usePluginStore } from '@/store/plugins'
import { loadedPlugins } from '@/lib/plugins/loader'
import { checkAppVersion } from '@/lib/plugins/manifest'
import { PERMISSION_LABELS, type PluginPermission } from '@/lib/plugins/types'
import { APP_VERSION } from '../settings/versionHistory'
import { useForumStore } from '@/store/forum'

// Where a user finds a plugin somebody else wrote.
//
// Master/detail, in the shape of DataConnectorDialog — the app's other
// browse-then-import surface — because the gesture is the same one: look
// through a list of things you have not seen, read about one, bring it in.
//
// Three things about this dialog are decisions rather than layout:
//
//  * **Browsing works signed out; installing does not.** The bundles bucket is
//    private, which is the only part of protecting an author's code that is
//    more than a locked door in this interface. So the sign-in prompt appears
//    on the Install button and nowhere else — gating the whole dialog would
//    make the store invisible to exactly the people deciding whether to make
//    an account.
//  * **Nothing installed here is switched on.** The button says so before it
//    is pressed, not after. A download is not consent; the Plugin Manager's
//    enable switch is.
//  * **A plugin that needs a newer ouRGeo says so instead of installing.** The
//    check is on the version row, before the download, because an incompatible
//    plugin that installs and then fails to load looks like a broken plugin
//    rather than an old app.

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PluginStoreDialog({ open, onOpenChange }: Props): React.ReactElement {
  const {
    query, category, sort, categories, listings, loading, error, selected, updates,
    setQuery, setCategory, setSort, setCategories, setListings, setLoading, setError, select,
  } = usePluginStoreBrowser()

  const revision = usePluginStore((s) => s.revision)
  const profile = useForumStore((s) => s.profile)
  const [signedIn, setSignedIn] = useState(false)
  const [detail, setDetail] = useState<StoreDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Read at render, not memoised. `loadedPlugins()` is a module-level array
  // whose identity never changes, so React cannot subscribe to it — the
  // subscription above is to `revision`, which is bumped once per registration
  // pass. Same arrangement `WebApisTab` uses for `providerList()`, and a
  // `useMemo` keyed on `revision` would only be a dependency the lint rule
  // cannot recognise.
  void revision
  const installed = new Map<string, string>()
  for (const p of loadedPlugins()) installed.set(p.manifest.id, p.manifest.version)

  // Whether the account can install, without a round trip. `account:status`
  // reads the keychain file; a full restore is a refresh grant plus a profile
  // fetch, and this dialog must draw before either could finish.
  useEffect(() => {
    if (!open) return
    let live = true
    void store.accountStatus()
      .then((s) => { if (live) setSignedIn(s.signedIn || s.hasStoredToken) })
      .catch(() => { /* offline: the Install button says so when pressed */ })
    return () => { live = false }
  }, [open, profile])

  // The same once-per-session poll the Plugin Manager fires. Either door.
  useEffect(() => { if (open) void ensureUpdateCheck() }, [open])

  useEffect(() => {
    if (!open || categories.length > 0) return
    void store.categories().then(setCategories).catch(() => { /* chips are optional */ })
  }, [open, categories.length, setCategories])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setListings(await store.catalogue({
        query: query || undefined,
        category: category ?? undefined,
        sort,
        limit: 60,
      }))
    } catch (e) {
      setError(store.storeErrorMessage(e))
      setListings([])
    } finally {
      setLoading(false)
    }
  }, [query, category, sort, setListings, setLoading, setError])

  // Typing filters, but not on every keystroke: the catalogue is one RPC and a
  // search box that fires per character opens a request the user has already
  // made irrelevant. Same 400 ms the Data Connector's dynamic search uses.
  useEffect(() => {
    if (!open) return
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => { void load() }, query ? 400 : 0)
    return () => clearTimeout(debounce.current)
  }, [open, load, query])

  useEffect(() => {
    if (!selected) { setDetail(null); return }
    let live = true
    setDetailLoading(true)
    void store.detail(selected)
      .then((d) => { if (live) setDetail(d) })
      .catch((e) => { if (live) { setDetail(null); setError(store.storeErrorMessage(e)) } })
      .finally(() => { if (live) setDetailLoading(false) })
    return () => { live = false }
  }, [selected, setError])

  const refreshDetail = useCallback(async (slug: string) => {
    setDetail(await store.detail(slug).catch(() => null))
  }, [])

  const onInstall = async (d: StoreDetail, versionId: string, version: string, need: string | null): Promise<void> => {
    setBusy(d.slug)
    setNotice(null)
    const already = installed.get(d.slug)
    const result = already
      ? await updateFromStore(d.slug, versionId, { ourgeoVersion: need })
      : await installFromStore(d.slug, versionId, { ourgeoVersion: need, version, name: d.name })
    setBusy(null)
    if (!result.ok) { setNotice(result.error ?? 'That did not work.'); return }
    setNotice(already
      ? `Updated "${d.name}" to ${version}.`
      : `Installed "${d.name}". It is switched off — turn it on in Settings → Plugins.`)
    await refreshDetail(d.slug)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50
            w-[860px] max-w-[95vw] h-[80vh] flex flex-col
            bg-geo-panel border border-geo-border rounded-lg shadow-xl focus:outline-none"
          data-ourgeo-id="pluginStore.dialog"
        >
          <div className="flex items-start justify-between px-5 py-4 border-b border-geo-border shrink-0">
            <div className="min-w-0">
              <Dialog.Title className="text-sm font-semibold text-foreground">Plugin Store</Dialog.Title>
              <Dialog.Description className="text-[11px] text-geo-muted mt-1 leading-snug">
                Plugins written by other ouRGeo users, reviewed before they appear here.
                Anything you install arrives switched off, so turning it on stays your decision.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-geo-muted hover:text-foreground shrink-0">
                <X className="w-3.5 h-3.5" />
              </Button>
            </Dialog.Close>
          </div>

          <div className="flex items-center gap-2 px-5 py-2 border-b border-geo-border shrink-0">
            <div className="flex items-center gap-1.5 bg-geo-bg border border-geo-border rounded px-2 py-1 flex-1 min-w-0">
              <Search className="w-3 h-3 text-geo-muted shrink-0" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search plugins…"
                aria-label="Search plugins"
                data-ourgeo-id="pluginStore.search"
                className="flex-1 min-w-0 bg-transparent text-xs focus:outline-none placeholder:text-geo-muted"
              />
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as StoreSort)}
              aria-label="Sort plugins"
              className="bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground"
            >
              {(Object.keys(SORT_LABELS) as StoreSort[]).map((s) => (
                <option key={s} value={s}>{SORT_LABELS[s]}</option>
              ))}
            </select>
            <Button
              variant="ghost" size="sm" className="h-6 text-xs gap-1.5 text-geo-muted"
              onClick={() => { void load() }}
            >
              <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} /> Refresh
            </Button>
          </div>

          {categories.length > 0 && (
            <div className="flex items-center gap-1 px-5 py-2 border-b border-geo-border shrink-0 flex-wrap">
              <Chip active={category === null} onClick={() => setCategory(null)}>All</Chip>
              {categories.map((c) => (
                <Chip key={c.slug} active={category === c.slug} onClick={() => setCategory(c.slug)} title={c.description}>
                  {c.icon} {c.name}
                </Chip>
              ))}
            </div>
          )}

          {notice && (
            <div className="px-5 py-2 text-[11px] text-geo-accent border-b border-geo-border shrink-0">
              {notice}
            </div>
          )}

          <div className="flex flex-1 min-h-0">
            <div className="w-[290px] shrink-0 border-r border-geo-border flex flex-col min-h-0">
              <ScrollArea className="flex-1 min-h-0">
                <div className="p-2 space-y-1">
                  {loading && listings.length === 0 && (
                    <div className="flex items-center gap-2 p-3 text-xs text-geo-muted">
                      <Loader2 className="w-3 h-3 animate-spin" /> Loading the store…
                    </div>
                  )}
                  {error && (
                    <div className="flex items-start gap-2 m-1 p-2 bg-geo-error/10 border border-geo-error/30 rounded">
                      <AlertCircle className="w-3 h-3 text-geo-error shrink-0 mt-0.5" />
                      <p className="text-[11px] text-geo-error leading-snug">{error}</p>
                    </div>
                  )}
                  {!loading && !error && listings.length === 0 && (
                    <div className="text-center py-10 px-3">
                      <Puzzle className="w-7 h-7 mx-auto text-geo-muted mb-3" />
                      <p className="text-xs text-geo-muted">
                        {query || category ? 'Nothing matches that.' : 'The store is empty so far.'}
                      </p>
                    </div>
                  )}
                  {listings.map((l) => (
                    <ListingRow
                      key={l.slug}
                      listing={l}
                      active={selected === l.slug}
                      installedVersion={installed.get(l.slug)}
                      hasUpdate={Boolean(updates[l.slug]?.latestVersion
                        && updates[l.slug]?.latestVersion !== installed.get(l.slug))}
                      onClick={() => select(l.slug)}
                    />
                  ))}
                </div>
              </ScrollArea>
            </div>

            <div className="flex-1 min-w-0 flex flex-col min-h-0">
              {detailLoading && (
                <div className="flex items-center gap-2 p-5 text-xs text-geo-muted">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading…
                </div>
              )}
              {!detailLoading && !detail && (
                <div className="flex-1 grid place-items-center p-8 text-center">
                  <div>
                    <Puzzle className="w-8 h-8 mx-auto text-geo-muted mb-3" />
                    <p className="text-xs text-geo-muted">Pick a plugin to read about it.</p>
                  </div>
                </div>
              )}
              {!detailLoading && detail && (
                <DetailPane
                  detail={detail}
                  signedIn={signedIn}
                  busy={busy === detail.slug}
                  installedVersion={installed.get(detail.slug)}
                  onInstall={onInstall}
                />
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Chip({
  active, onClick, title, children,
}: {
  active: boolean; onClick: () => void; title?: string; children: React.ReactNode
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'px-2 py-0.5 text-[10px] rounded-full border transition-colors',
        active
          ? 'bg-geo-accent text-white border-geo-accent'
          : 'text-geo-muted border-geo-border hover:text-foreground hover:bg-white/5',
      )}
    >
      {children}
    </button>
  )
}

function ListingRow({
  listing, active, installedVersion, hasUpdate, onClick,
}: {
  listing: StoreListing
  active: boolean
  installedVersion?: string
  hasUpdate: boolean
  onClick: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left rounded p-2 transition-colors',
        active ? 'bg-geo-accent/10' : 'hover:bg-white/5',
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className={cn('text-xs font-medium truncate', active ? 'text-geo-accent' : 'text-foreground')}>
          {listing.name}
        </span>
        {installedVersion && !hasUpdate && (
          <Check className="w-3 h-3 text-geo-success shrink-0" aria-label="Installed" />
        )}
        {hasUpdate && (
          <ArrowUpCircle className="w-3 h-3 text-geo-accent shrink-0" aria-label="Update available" />
        )}
      </div>
      <p className="text-[10px] text-geo-muted mt-0.5 leading-snug line-clamp-2">{listing.summary}</p>
      <div className="flex items-center gap-2 mt-1 text-[10px] text-geo-muted">
        <span>{listing.author}</span>
        <span>·</span>
        <span>{listing.installCount} installed</span>
        {listing.ratingCount > 0 && (
          <>
            <span>·</span>
            <span className="flex items-center gap-0.5">
              <Star className="w-2.5 h-2.5" /> {listing.ratingAvg}
            </span>
          </>
        )}
      </div>
    </button>
  )
}

function DetailPane({
  detail, signedIn, busy, installedVersion, onInstall,
}: {
  detail: StoreDetail
  signedIn: boolean
  busy: boolean
  installedVersion?: string
  onInstall: (d: StoreDetail, versionId: string, version: string, need: string | null) => void
}): React.ReactElement {
  const latest = detail.versions.find((v) => v.status === 'approved') ?? detail.versions[0]
  const needsNewer = latest?.ourgeoVersion ? checkAppVersion(latest.ourgeoVersion, APP_VERSION) : null
  const upToDate = installedVersion !== undefined && installedVersion === latest?.version
  const permissions = (latest?.permissions ?? []) as PluginPermission[]

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{detail.name}</h3>
            <p className="text-[11px] text-geo-muted mt-0.5">
              {detail.author.displayName}
              {latest && <> · v{latest.version}</>}
              {latest && <> · {Math.max(1, Math.round(latest.bytes / 1024))} KB</>}
              {' · '}{detail.installCount} installed
              {detail.ratingCount > 0 && <> · ★ {detail.ratingAvg} ({detail.ratingCount})</>}
            </p>
            <p className="text-xs text-foreground mt-2 leading-snug">{detail.summary}</p>
          </div>

          {detail.media.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {detail.media.map((m) => (
                <img
                  key={m.path}
                  src={m.url}
                  alt={m.alt ?? ''}
                  className="h-32 rounded border border-geo-border shrink-0"
                />
              ))}
            </div>
          )}

          {detail.description && (
            <p className="text-[11px] text-geo-muted whitespace-pre-wrap leading-relaxed">
              {detail.description}
            </p>
          )}

          <div className="space-y-1 text-[10px] text-geo-muted">
            <p>
              {latest?.hasCode
                ? 'Ships code — it runs inside ouRGeo when you enable it.'
                : 'Declarative only — it adds data, and runs no code of its own.'}
            </p>
            {permissions.length > 0 && (
              <p>Asks to: {permissions.map((p) => PERMISSION_LABELS[p] ?? p).join('; ')}.</p>
            )}
            {detail.tags.length > 0 && <p>Tags: {detail.tags.join(', ')}.</p>}
            {detail.license && <p>Licence: {detail.license}.</p>}
          </div>

          {latest?.changelog && (
            <div>
              <p className="text-[10px] font-semibold text-geo-muted uppercase tracking-wider">
                What changed in {latest.version}
              </p>
              <p className="text-[11px] text-geo-muted mt-1 whitespace-pre-wrap leading-snug">
                {latest.changelog}
              </p>
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="border-t border-geo-border p-4 shrink-0 space-y-2">
        {needsNewer && (
          <p className="flex items-start gap-1.5 text-[11px] text-geo-warning">
            <ShieldAlert className="w-3 h-3 shrink-0 mt-px" /> {needsNewer}
          </p>
        )}
        {!signedIn && (
          <p className="text-[11px] text-geo-muted leading-snug">
            Installing needs your ourgeo.dev account — plugin downloads are not public, so the
            author&rsquo;s code is not on an open URL. Sign in from the Publish dialog, or on
            ourgeo.dev.
          </p>
        )}

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="h-7 text-xs gap-1.5"
            data-ourgeo-id="pluginStore.install"
            disabled={busy || upToDate || !latest || Boolean(needsNewer) || !signedIn}
            onClick={() => latest && onInstall(detail, latest.id, latest.version, latest.ourgeoVersion)}
          >
            {busy
              ? <><Loader2 className="w-3 h-3 animate-spin" /> Working…</>
              : upToDate
                ? <><Check className="w-3 h-3" /> Installed</>
                : installedVersion
                  ? <><ArrowUpCircle className="w-3 h-3" /> Update to {latest?.version}</>
                  : <><Download className="w-3 h-3" /> Install</>}
          </Button>
          <Button
            variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-geo-muted"
            onClick={() => { void window.electronAPI.shell.openExternal(detail.pageUrl) }}
          >
            <ExternalLink className="w-3 h-3" /> Store page
          </Button>
          <div className="flex-1" />
          {!upToDate && !installedVersion && signedIn && !needsNewer && (
            <span className="text-[10px] text-geo-muted">Arrives switched off.</span>
          )}
        </div>
      </div>
    </div>
  )
}
