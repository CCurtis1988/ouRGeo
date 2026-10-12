import { useEffect, useState, useSyncExternalStore } from 'react'
import { folderCatalogueSnapshot, refreshFolderSources, subscribeFolderCatalogue } from '@/lib/context/folder-sources'
import { useSessionStore } from '@/store/session'
import type { FolderContextApi } from '@/lib/context/folders'

export function ContextFolders({ api, lease }: { api: FolderContextApi; lease: string }): React.ReactElement {
  const catalogue = useSyncExternalStore(subscribeFolderCatalogue, folderCatalogueSnapshot)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => { void refreshFolderSources(api, lease).catch(error => setMessage(String(error))) }, [api, lease])
  const run = async (operation: () => Promise<unknown>): Promise<void> => {
    setBusy(true); setMessage('')
    try { await operation(); useSessionStore.getState().addConsoleEntry('info', 'Context folders: source access updated.'); await refreshFolderSources(api, lease); setMessage('Folder sources updated. Selected file excerpts are sent only when retrieved.') }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  return <section aria-label="Folder context sources" className="space-y-2 border-t border-geo-border pt-3">
    <h4 className="text-sm font-medium text-foreground">Folder sources</h4>
    <p className="text-xs text-geo-muted">Choose folders for this workspace. UTF-8 text files below 1 MB are searchable; symlinks, credential files and ignored paths are excluded. File changes remove cached excerpts until you refresh. Access ends when you switch workspace or close the app.</p>
    <button type="button" disabled={busy || !lease} onClick={() => void run(() => api.chooseContextFolder(lease))} className="rounded border border-geo-border px-2 py-1 text-xs text-foreground disabled:opacity-50">Choose folder…</button>
    {catalogue.folders.map(folder => <div key={folder.id} className="flex flex-wrap items-center gap-2 text-xs text-foreground">
      <span>{folder.title}: {folder.files} files{folder.needsRefresh ? ' (refresh required)' : folder.limited ? ' (scan limit reached)' : ''}; {folder.omitted} excluded</span>
      <button type="button" disabled={busy} aria-label={`Refresh folder ${folder.title}`} onClick={() => void run(() => api.refreshContextFolder(folder.id, lease))} className="rounded border border-geo-border px-2 py-1">Refresh</button>
      <button type="button" disabled={busy} aria-label={`Remove folder ${folder.title}`} onClick={() => void run(() => api.removeContextFolder(folder.id, lease))} className="rounded border border-geo-border px-2 py-1">Remove</button>
    </div>)}
    {message && <p role="status" className="text-xs text-geo-muted">{message}</p>}
  </section>
}
