import React, { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { ArrowUpCircle, CheckCircle2, Download, ExternalLink, Loader2, X } from 'lucide-react'
import { useAppUpdatesStore } from '@/store/app-updates'
import { useUiStore } from '@/store/ui'
import { useProjectStore } from '@/store/project'
import { useSessionStore } from '@/store/session'
import { saveCurrentProject } from '@/lib/project-persistence'
import { updateInstructions, type InstallerFormat } from '@/lib/app-updates'
import { Switch } from '@/components/ui/switch'

const button = 'rounded-md border border-geo-border px-3 py-2 text-xs text-foreground hover:bg-geo-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-geo-accent disabled:opacity-50'
const primary = `${button} bg-geo-accent text-geo-bg hover:bg-geo-accent-hover`
export function AppUpdateDialog(): React.ReactElement {
  const open = useUiStore(state => state.openDialog === 'app-update')
  const state = useAppUpdatesStore()
  const [selected, setSelected] = useState<InstallerFormat>('AppImage')
  const [openedVersion, setOpenedVersion] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const phase = useProjectStore(state => state.phase)
  const rPort = useSessionStore(state => state.rPort)
  const init = state.init, dismissStartup = state.dismissStartup
  useEffect(() => {
    if (!open) return
    dismissStartup()
    void init()
  }, [open, init, dismissStartup])
  const status = state.status
  const available = status?.state === 'available'
  const file = status?.downloads.find(file => file.format === selected) ?? status?.downloads[0]
  const opened = available && openedVersion === status.latestVersion
  const close = (): void => { state.dismissStartup(); useUiStore.getState().hideDialog('app-update') }
  const download = async (): Promise<void> => {
    if (!file) return
    try { await state.open(file.format); setOpenedVersion(file.version); setNotice(null) } catch { /* store shows browser recovery */ }
  }
  const save = async (): Promise<void> => {
    setSaving(true); setNotice(null)
    try { if (await saveCurrentProject()) setNotice('Project saved.'); }
    catch (error) { setNotice(`Project could not be saved: ${String(error)}. Keep ouRGeo open and retry before updating.`) }
    finally { setSaving(false) }
  }
  return <Dialog.Root open={open} onOpenChange={value => { if (!value && !saving) close() }}>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <Dialog.Content data-ourgeo-id="updates.dialog" className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[560px] max-w-[95vw] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-geo-border bg-geo-panel text-foreground shadow-xl focus:outline-none">
        <div className="flex items-start gap-3 border-b border-geo-border px-5 py-4">
          <ArrowUpCircle className="mt-0.5 h-5 w-5 shrink-0 text-geo-accent" />
          <div className="min-w-0 flex-1"><Dialog.Title className="text-sm font-semibold">{available ? `ouRGeo ${status.latestVersion} is available` : 'ouRGeo updates'}</Dialog.Title><Dialog.Description className="mt-1 text-xs text-geo-muted">{status ? `Installed version ${status.currentVersion} · ${status.platform} / ${status.arch}` : 'Check published installers and update when you are ready.'}</Dialog.Description></div>
          <button aria-label="Close updates" disabled={saving} onClick={close} className="rounded p-1 text-geo-muted hover:text-foreground"><X size={16} /></button>
        </div>
        <div className="space-y-4 overflow-y-auto px-5 py-4 text-xs">
          {state.checking && <p role="status" className="flex items-center gap-2 text-geo-muted"><Loader2 size={14} className="animate-spin" />Checking published installers…</p>}
          {!state.checking && status?.state === 'current' && <p className="flex items-start gap-2"><CheckCircle2 size={16} className="shrink-0 text-geo-accent" />No update is needed. Latest published installer for this installation: {status.latestVersion}.</p>}
          {!state.checking && ['development', 'unavailable', 'error'].includes(status?.state ?? '') && <p role={status?.state === 'error' ? 'alert' : 'status'} className="text-geo-muted">{status?.message}</p>}
          {available && file && <>
            <p className="leading-relaxed text-geo-muted">{opened ? 'The download was opened in your browser. After it finishes, follow these steps.' : 'Download the official installer, then follow the steps below when you are ready. You can keep working and update later.'}</p>
            {status.downloads.length > 1 && <label className="flex items-center gap-3">Installer<select aria-label="Update installer" value={file.format} onChange={event => setSelected(event.target.value as InstallerFormat)} className="rounded border border-geo-border bg-geo-bg px-2 py-1 text-foreground">{status.downloads.map(file => <option key={file.format} value={file.format}>{file.format === 'deb' ? 'Debian / Ubuntu (.deb)' : file.format === 'AppImage' ? 'AppImage' : file.format}</option>)}</select></label>}
            <div className="rounded-lg border border-geo-border bg-geo-bg p-3"><p className="mb-3 break-all font-mono text-[11px]">{file.fileName}</p><ol className="ml-4 list-decimal space-y-2 text-geo-muted">{updateInstructions(file.format, file.fileName).map(step => <li key={step} className="pl-1 leading-relaxed">{step}</li>)}</ol></div>
            {opened && <div className="flex flex-wrap gap-2">
              <button data-ourgeo-id="updates.saveProject" className={button} title={!rPort ? 'Wait for the R session to connect before saving the project.' : undefined} disabled={saving || phase === 'loading' || !rPort} onClick={() => void save()}>{saving ? 'Saving…' : 'Save project…'}</button>
              <button data-ourgeo-id="updates.closeApp" className={button} disabled={saving} onClick={() => { close(); void window.electronAPI.updates.quit().catch(() => useAppUpdatesStore.setState({ error: 'Close ouRGeo using its window controls before installing.' })) }}>Close ouRGeo…</button>
            </div>}
            <p className="text-[11px] leading-relaxed text-geo-muted">The installer updates the application. Your project files and R installation are separate; do not uninstall them. ouRGeo will use its usual save prompt before closing.</p>
          </>}
          {state.error && <p role="alert" className="text-geo-error">{state.error}</p>}
          {notice && <p role="status" className="text-geo-muted">{notice}</p>}
          {status?.checkedAt && <p className="text-[10px] text-geo-muted">Last checked {new Date(status.checkedAt).toLocaleString()}</p>}
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-[11px]">
            <button data-ourgeo-id="updates.releaseNotes" className="inline-flex items-center gap-1 text-geo-accent hover:underline" onClick={() => void state.open('notes').catch(() => undefined)}>Release notes<ExternalLink size={11} /></button>
            <button data-ourgeo-id="updates.officialDownloads" className="inline-flex items-center gap-1 text-geo-accent hover:underline" onClick={() => void state.open('downloads').catch(() => undefined)}>Official downloads<ExternalLink size={11} /></button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-geo-border px-5 py-3">
          <div className="flex gap-2"><button data-ourgeo-id="updates.checkAgain" className={button} disabled={state.checking || saving} onClick={() => void state.check('manual')}>{state.checking ? 'Checking…' : 'Check again'}</button>{available && <button data-ourgeo-id="updates.skipVersion" className={button} disabled={saving} onClick={() => { void state.preferences({ skippedVersion: status.latestVersion }).then(close).catch(() => undefined) }}>Skip this version</button>}</div>
          {available ? <button data-ourgeo-id="updates.download" className={primary} disabled={state.checking || saving} onClick={() => void download()}><Download className="mr-1 inline h-3 w-3" />{opened ? 'Download again' : 'Download update'}</button> : <button className={button} onClick={close}>Done</button>}
        </div>
        {available && <button data-ourgeo-id="updates.later" className="pb-3 text-[11px] text-geo-muted hover:text-foreground" disabled={saving} onClick={close}>Remind me next time</button>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}

export function AppUpdateSettings(): React.ReactElement {
  const status = useAppUpdatesStore(state => state.status)
  const error = useAppUpdatesStore(state => state.error)
  const init = useAppUpdatesStore(state => state.init)
  useEffect(() => { void init() }, [init])
  return <div className="space-y-4">
    <p className="text-xs leading-relaxed text-geo-muted">Check for published installers and follow the update steps for your system. Your current work stays open until you choose to close ouRGeo.</p>
    <button data-ourgeo-id="settings.checkUpdates" className={button} onClick={() => { useAppUpdatesStore.getState().dismissStartup(); useUiStore.getState().showDialog('app-update'); void useAppUpdatesStore.getState().check('manual') }}>Check for updates…</button>
    <Switch data-ourgeo-id="updates.automatic" label="Check for updates when ouRGeo starts" checked={status?.preferences.automatic ?? true} disabled={!status}
      description="Checks ourgeo.dev for compatible installers. Up-to-date installations and offline checks stay quiet; no project files are sent."
      onChange={automatic => { void useAppUpdatesStore.getState().preferences({ automatic }).catch(() => undefined) }} />
    {status?.preferences.skippedVersion && <p className="text-xs text-geo-muted">Skipping startup reminders for {status.preferences.skippedVersion}. <button className="text-geo-accent hover:underline" onClick={() => void useAppUpdatesStore.getState().preferences({ skippedVersion: null }).catch(() => undefined)}>Show reminders again</button></p>}
    {error && <p role="alert" className="text-xs text-geo-error">{error}</p>}
  </div>
}
