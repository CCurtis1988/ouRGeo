import React, { useCallback, useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  X, RefreshCw, Trash2, FolderOpen, Download, Upload, AlertTriangle, Puzzle,
} from 'lucide-react'
import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'
import { loadedPlugins, pluginEnabled, setPluginEnabled, reloadPlugins } from '@/lib/plugins/loader'
import { PERMISSION_LABELS, type LoadedPlugin, type PluginPermission } from '@/lib/plugins/types'
import { Store, ArrowUpCircle } from 'lucide-react'
import { usePluginStoreBrowser, hasUpdate } from '@/store/pluginStore'
import { ensureUpdateCheck } from '@/lib/plugin-store/updates'
import { updateFromStore } from '@/lib/plugin-store/install'
import { dismissUpdate } from '@/lib/plugin-store-persistence'
import { useUiStore } from '@/store/ui'
import { usePluginStore } from '@/store/plugins'
import { APP_VERSION } from './versionHistory'
import { cn } from '@/lib/utils'

// Where the user decides what runs.
//
// The consent moment is the enable switch, and it has to be honest about what
// it is: a plugin with an entry point is code, running with everything the
// renderer can do, written by whoever wrote the plugin. The soft sandbox in
// lib/plugins/sandbox.ts stops accidents, not intent. So the dialog says that
// in the same words the docs use — this is the decision you already make when
// ouRGeo tells you to run `install.packages()` — rather than implying a
// guarantee that does not exist.
//
// A declarative plugin carries no such decision, and the dialog says so too:
// there is a real difference between "adds a connector, described in JSON" and
// "runs a program", and flattening the two would train users to click through
// the one that matters.

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PluginManagerDialog({ open, onOpenChange }: Props): React.ReactElement {
  const revision = usePluginStore((s) => s.revision)
  const showDialog = useUiStore((s) => s.showDialog)
  const updates = usePluginStoreBrowser((s) => s.updates)
  const clearUpdate = usePluginStoreBrowser((s) => s.clearUpdate)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [plugins, setPlugins] = useState<LoadedPlugin[]>(loadedPlugins())

  useEffect(() => { setPlugins(loadedPlugins()) }, [revision, open])

  // Once per session, on the first open of this dialog or the store — not at
  // startup. See lib/plugin-store/updates.ts for why.
  useEffect(() => { if (open) void ensureUpdateCheck() }, [open])

  const refresh = useCallback(async () => {
    setBusy('*')
    try {
      setPlugins(await reloadPlugins(APP_VERSION))
      setNotice(null)
    } finally {
      setBusy(null)
    }
  }, [])

  const toggle = useCallback(async (id: string, enabled: boolean) => {
    setBusy(id)
    try {
      await setPluginEnabled(id, enabled, APP_VERSION)
      setPlugins(loadedPlugins())
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }, [])

  const remove = useCallback(async (id: string) => {
    setBusy(id)
    try {
      await window.electronAPI.plugins.delete(id)
      await setPluginEnabled(id, false, APP_VERSION)
      setPlugins(loadedPlugins())
      setConfirmDelete(null)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }, [])

  const install = useCallback(async () => {
    const file = await window.electronAPI.dialog.openFile()
    if (!file) return
    setBusy('*')
    try {
      const id = await window.electronAPI.plugins.unpack(file)
      await reloadPlugins(APP_VERSION)
      setPlugins(loadedPlugins())
      // Installed, NOT enabled. Arriving switched on would make the download
      // itself the consent, which is the thing this dialog exists to prevent.
      setNotice(`Installed "${id}". It is switched off — turn it on when you are ready.`)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }, [])

  const update = useCallback(async (id: string) => {
    const u = updates[id]
    if (!u?.latestId) return
    setBusy(id)
    try {
      const result = await updateFromStore(id, u.latestId, { ourgeoVersion: u.ourgeoVersion })
      setNotice(result.ok
        ? `Updated to ${u.latestVersion}.`
        : result.error ?? 'That did not work.')
      if (result.ok) clearUpdate(id)
      setPlugins(loadedPlugins())
    } finally {
      setBusy(null)
    }
  }, [updates, clearUpdate])

  const dismiss = useCallback(async (id: string) => {
    const u = updates[id]
    if (!u?.latestVersion) return
    // Keyed by version, so a later one is offered again. "Not this one" is
    // what a person means by dismissing an update.
    await dismissUpdate(id, u.latestVersion)
    clearUpdate(id)
  }, [updates, clearUpdate])

  const exportPlugin = useCallback(async (id: string) => {
    const out = await window.electronAPI.dialog.saveExportFile(`${id}.ourgeoplugin`)
    if (!out) return
    try {
      await window.electronAPI.plugins.pack(id, out)
      setNotice(`Exported "${id}".`)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e))
    }
  }, [])

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50
            w-[680px] max-h-[85vh] flex flex-col
            bg-geo-panel border border-geo-border rounded-lg shadow-xl focus:outline-none"
        >
          <div className="flex items-start justify-between px-5 py-4 border-b border-geo-border shrink-0">
            <div className="min-w-0">
              <Dialog.Title className="text-sm font-semibold text-foreground">Plugins</Dialog.Title>
              <Dialog.Description className="text-[11px] text-geo-muted mt-1 leading-snug">
                Capabilities added to ouRGeo without rebuilding it — connectors, tools, actions,
                panels. A plugin that ships code runs with everything ouRGeo can do, so enable
                one the way you would run <code className="text-foreground">install.packages()</code>:
                because you know where it came from.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-geo-muted hover:text-foreground shrink-0">
                <X className="w-3.5 h-3.5" />
              </Button>
            </Dialog.Close>
          </div>

          <div className="flex items-center gap-2 px-5 py-2 border-b border-geo-border shrink-0">
            {/* First, because it is the route most people will take. Installing
                from a file stays beside it rather than under it: a plugin
                somebody sent you is not a lesser way to get one. */}
            <Button
              variant="ghost" size="sm" className="h-6 text-xs gap-1.5"
              data-ourgeo-id="plugins.browseStore"
              onClick={() => { onOpenChange(false); showDialog('plugin-store') }}
            >
              <Store className="w-3 h-3" /> Browse the store…
            </Button>
            <Button variant="ghost" size="sm" className="h-6 text-xs gap-1.5" onClick={install}>
              <Upload className="w-3 h-3" /> Install from file…
            </Button>
            <Button variant="ghost" size="sm" className="h-6 text-xs gap-1.5" onClick={refresh}>
              <RefreshCw className={cn('w-3 h-3', busy === '*' && 'animate-spin')} /> Reload all
            </Button>
            <div className="flex-1" />
            <Button
              variant="ghost" size="sm" className="h-6 text-xs gap-1.5 text-geo-muted"
              onClick={() => { void window.electronAPI.plugins.reveal('.') }}
            >
              <FolderOpen className="w-3 h-3" /> Open folder
            </Button>
          </div>

          {notice && (
            <div className="px-5 py-2 text-[11px] text-geo-accent border-b border-geo-border shrink-0">
              {notice}
            </div>
          )}

          <ScrollArea className="flex-1 min-h-0">
            <div className="px-5 py-3 space-y-3">
              {plugins.length === 0 && (
                <div className="text-center py-10">
                  <Puzzle className="w-8 h-8 mx-auto text-geo-muted mb-3" />
                  <p className="text-xs text-geo-muted">No plugins installed.</p>
                  <p className="text-[11px] text-geo-muted mt-2 max-w-sm mx-auto leading-snug">
                    Browse the store, ask the AI assistant for one — “add a connector for this
                    API” — or install a <code className="text-foreground">.ourgeoplugin</code> file
                    someone sent you.
                  </p>
                </div>
              )}

              {plugins.map((p) => (
                <PluginRow
                  key={p.manifest.id}
                  plugin={p}
                  busy={busy === p.manifest.id || busy === '*'}
                  confirming={confirmDelete === p.manifest.id}
                  onToggle={(v) => void toggle(p.manifest.id, v)}
                  onDelete={() => setConfirmDelete(p.manifest.id)}
                  onConfirmDelete={() => void remove(p.manifest.id)}
                  onCancelDelete={() => setConfirmDelete(null)}
                  onExport={() => void exportPlugin(p.manifest.id)}
                  onReveal={() => { void window.electronAPI.plugins.reveal(p.manifest.id) }}
                  update={hasUpdate(updates[p.manifest.id], p.manifest.version)
                    ? updates[p.manifest.id].latestVersion
                    : null}
                  onUpdate={() => void update(p.manifest.id)}
                  onDismissUpdate={() => void dismiss(p.manifest.id)}
                />
              ))}
            </div>
          </ScrollArea>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function PluginRow({
  plugin, busy, confirming, update,
  onToggle, onDelete, onConfirmDelete, onCancelDelete, onExport, onReveal,
  onUpdate, onDismissUpdate,
}: {
  plugin: LoadedPlugin
  busy: boolean
  confirming: boolean
  /** The newer version waiting in the store, or null. */
  update: string | null
  onToggle: (enabled: boolean) => void
  onDelete: () => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
  onExport: () => void
  onReveal: () => void
  onUpdate: () => void
  onDismissUpdate: () => void
}): React.ReactElement {
  const { manifest, state, error, registered, origin } = plugin
  const enabled = pluginEnabled(manifest.id)
  const permissions = (manifest.permissions ?? []) as PluginPermission[]
  const hasCode = Boolean(manifest.main)

  return (
    <div className="rounded-md border border-geo-border p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-foreground truncate">{manifest.name}</span>
            <span className="text-[10px] text-geo-muted">v{manifest.version}</span>
            <StateBadge state={state} />
            {origin && (
              <span
                className="flex items-center gap-0.5 text-[10px] text-geo-accent"
                title={`Installed from the plugin store on ${new Date(origin.installedAt).toLocaleDateString()}`}
              >
                <Store className="w-2.5 h-2.5" /> store
              </span>
            )}
          </div>
          {manifest.description && (
            <p className="text-[11px] text-geo-muted mt-1 leading-snug">{manifest.description}</p>
          )}

          <p className="text-[10px] text-geo-muted mt-1.5">
            {hasCode
              ? 'Ships code — it runs inside ouRGeo when enabled.'
              : 'Declarative only — it adds data, and runs no code of its own.'}
          </p>

          {permissions.length > 0 && (
            <p className="text-[10px] text-geo-muted mt-1">
              Asks to: {permissions.map((p) => PERMISSION_LABELS[p] ?? p).join('; ')}.
            </p>
          )}

          {registered.length > 0 && (
            <p className="text-[10px] text-geo-muted mt-1">
              Adds: {registered.join(', ')}.
            </p>
          )}

          {error && (
            // Shown whole, never clipped: a truncated stack is a bug report
            // nobody can act on, and this is the only place it is visible.
            <div className="mt-2 flex gap-1.5 text-[10px] text-geo-error">
              <AlertTriangle className="w-3 h-3 shrink-0 mt-px" />
              <pre className="whitespace-pre-wrap font-mono leading-snug min-w-0">{error}</pre>
            </div>
          )}
        </div>

        <label className="flex items-center gap-1.5 shrink-0 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy}
            onChange={(e) => onToggle(e.target.checked)}
            className="accent-[hsl(var(--geo-accent))]"
          />
          <span className="text-[11px] text-geo-muted">{enabled ? 'On' : 'Off'}</span>
        </label>
      </div>

      {update && (
        // Offered, never applied. An update replaces code the user already
        // decided to trust with code they have not seen, which is the same
        // decision `plugin:enable` puts behind a confirm.
        <div className="flex items-center gap-2 mt-2 rounded border border-geo-accent/40 bg-geo-accent/5 px-2 py-1.5">
          <ArrowUpCircle className="w-3 h-3 text-geo-accent shrink-0" />
          <span className="text-[10px] text-foreground flex-1 min-w-0">
            Version {update} is in the store.
          </span>
          <Button
            variant="ghost" size="sm" className="h-5 text-[10px] text-geo-muted"
            disabled={busy} onClick={onDismissUpdate}
          >
            Not now
          </Button>
          <Button size="sm" className="h-5 text-[10px]" disabled={busy} onClick={onUpdate}>
            Update
          </Button>
        </div>
      )}

      <div className="flex items-center gap-1 mt-2">
        {/*
          A store plugin gets neither. Export is refused in the main process, so
          a button here would be one that reliably fails; Files would open a
          folder whose only readable content is a minified bundle, which invites
          exactly the misunderstanding the store's copy works to avoid. The
          author's page is the honest destination.
        */}
        {origin ? (
          <Button
            variant="ghost" size="sm" className="h-5 text-[10px] gap-1 text-geo-muted"
            onClick={() => { void window.electronAPI.shell.openExternal(
              `https://ourgeo.dev/plugin.html?slug=${encodeURIComponent(origin.slug)}`) }}
          >
            <Store className="w-2.5 h-2.5" /> Store page
          </Button>
        ) : (
          <>
            <Button variant="ghost" size="sm" className="h-5 text-[10px] gap-1 text-geo-muted" onClick={onReveal}>
              <FolderOpen className="w-2.5 h-2.5" /> Files
            </Button>
            <Button variant="ghost" size="sm" className="h-5 text-[10px] gap-1 text-geo-muted" onClick={onExport}>
              <Download className="w-2.5 h-2.5" /> Export
            </Button>
          </>
        )}
        <div className="flex-1" />
        {confirming ? (
          <>
            <span className="text-[10px] text-geo-error mr-1">Delete its folder for good?</span>
            <Button variant="ghost" size="sm" className="h-5 text-[10px] text-geo-muted" onClick={onCancelDelete}>
              Cancel
            </Button>
            <Button variant="ghost" size="sm" className="h-5 text-[10px] text-geo-error" onClick={onConfirmDelete}>
              Delete
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" className="h-5 text-[10px] gap-1 text-geo-muted hover:text-geo-error" onClick={onDelete}>
            <Trash2 className="w-2.5 h-2.5" /> Delete
          </Button>
        )}
      </div>
    </div>
  )
}

function StateBadge({ state }: { state: LoadedPlugin['state'] }): React.ReactElement | null {
  if (state === 'active') return <Badge className="text-geo-success">active</Badge>
  if (state === 'failed') return <Badge className="text-geo-error">failed</Badge>
  if (state === 'skipped') return <Badge className="text-geo-warning">skipped</Badge>
  return null
}

function Badge({ className, children }: { className: string; children: React.ReactNode }): React.ReactElement {
  return <span className={cn('text-[10px] px-1 rounded border border-current/40', className)}>{children}</span>
}
