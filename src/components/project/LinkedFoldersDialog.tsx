import React, { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useProjectFilesStore } from '@/store/project-files'
import { useProjectStore } from '@/store/project'
import type { ProjectLinkedFolder } from '@/lib/project-files'
import { fileSize, LINKED_FOLDER_STATUS_LABELS } from '@/lib/project-files-ui'

const CONTROL = 'rounded border border-geo-border bg-geo-bg px-2 py-1 text-xs text-foreground placeholder:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-geo-accent'
const BUTTON = `${CONTROL} hover:bg-geo-panel disabled:opacity-50 disabled:cursor-not-allowed`

function FolderCard({ folder, busy, run, forget }: { folder: ProjectLinkedFolder; busy: boolean; run: (action: () => Promise<unknown>) => void; forget: () => void }): React.ReactElement {
  const store = useProjectFilesStore()
  const [name, setName] = useState(folder.name)
  useEffect(() => setName(folder.name), [folder.id, folder.name])
  const files = store.catalogue.files.filter(file => file.storage?.folderId === folder.id)
  return <section role="group" aria-label={`Linked folder ${folder.name}`} className="rounded border border-geo-border p-3 space-y-2 min-w-0">
    <div className="flex items-center justify-between flex-wrap gap-2"><h3 className="text-sm font-medium break-words">{folder.name}</h3><span className="text-xs" role="status">{LINKED_FOLDER_STATUS_LABELS[folder.status]}</span></div>
    <p className="text-xs break-all">{folder.path || 'Choose a folder on this device to restore access.'}</p>
    <p className="text-xs">{files.length} files · {fileSize(files.reduce((sum, file) => sum + file.bytes, 0))} external{folder.lastScannedAt ? ` · Last scanned ${new Date(folder.lastScannedAt).toLocaleString()}` : ''}</p>
    {folder.issue && <p className="text-xs whitespace-pre-wrap">{folder.issue}</p>}
    {(folder.limited || !!folder.omitted) && <p className="text-xs">{folder.limited ? 'This scan reached a processing limit. ' : ''}{folder.omitted ? `${folder.omitted} entries were omitted by exclusions, access checks or scan limits. ` : ''}{folder.limited ? 'Narrow the linked folder or split its contents into smaller folders, then rescan.' : 'Ignored and private files stay outside this project library.'}</p>}
    {folder.status !== 'ready' && <p className="text-xs">Its catalogue remains visible. Assistant reading is paused until the folder is linked and its scan is current.</p>}
    <form className="flex items-end flex-wrap gap-2" onSubmit={event => { event.preventDefault(); run(() => store.renameLinkedFolder(folder.id, name.trim())) }}>
      <label className="text-xs flex-1 min-w-36">Folder label<input aria-label={`Folder label for ${folder.name}`} value={name} onChange={event => setName(event.target.value)} required className={`${CONTROL} block w-full mt-1`} /></label>
      <button type="submit" className={BUTTON} disabled={busy || !name.trim() || name.trim() === folder.name} data-ourgeo-id="projectFiles.renameLinkedFolder">Save folder label</button>
    </form>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={BUTTON} disabled={busy} onClick={() => run(() => store.rescanFolders([folder.id]))} data-ourgeo-id="projectFiles.rescanFolder">Rescan folder</button>
      <button type="button" className={BUTTON} disabled={busy} onClick={() => run(() => store.relinkFolder(folder.id))} data-ourgeo-id="projectFiles.relinkFolder">Relink folder…</button>
      <button type="button" className={BUTTON} disabled={busy} onClick={forget} data-ourgeo-id="projectFiles.forgetFolder">Forget link…</button>
    </div>
  </section>
}

export function LinkedFoldersDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }): React.ReactElement {
  const store = useProjectFilesStore()
  const path = useProjectStore(state => state.path), epoch = useProjectStore(state => state.workspaceEpoch)
  const previousEpoch = useRef(epoch)
  const [busy, setBusy] = useState(false), [creating, setCreating] = useState(false), [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null), [forgetting, setForgetting] = useState<ProjectLinkedFolder | null>(null)
  const linked = store.catalogue.linkedFolders ?? []
  const operation = store.catalogue.operation
  const blocked = busy || !!operation
  useEffect(() => { if (!open) { setError(null); setCreating(false); setForgetting(null) } }, [open])
  useEffect(() => {
    if (previousEpoch.current !== epoch) { previousEpoch.current = epoch; onOpenChange(false) }
  }, [epoch, onOpenChange])
  const run = (action: () => Promise<unknown>): void => {
    setError(null); setBusy(true)
    void Promise.resolve().then(action).catch(reason => setError(`${reason instanceof Error ? reason.message : String(reason)} Try again or close and reopen Linked folders.`)).finally(() => setBusy(false))
  }
  return <>
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-geo-bg/80 z-[60]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[60] w-[calc(100%_-_2rem)] max-w-2xl max-h-[85vh] overflow-auto rounded-lg border border-geo-border bg-geo-panel text-foreground p-4 space-y-4" data-ourgeo-id="projectFiles.linkedFoldersDialog">
          <div className="flex justify-between items-center gap-2"><Dialog.Title className="text-sm font-semibold">Linked folders</Dialog.Title><Dialog.Close className={BUTTON} aria-label="Close linked folders"><X className="w-4 h-4" /></Dialog.Close></div>
          <Dialog.Description className="text-xs">Keep working files in folders on disk and use them alongside files stored in this project. Linked originals stay outside the .ourgeoproj bundle; another device must explicitly relink its own folder.</Dialog.Description>
          {!path && <p className="text-xs">Save a named project before linking or creating a folder. Cancelling Save As creates nothing.</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BUTTON} disabled={blocked} onClick={() => run(() => store.linkFolder())} data-ourgeo-id="projectFiles.linkFolder">Link folder…</button>
            <button type="button" className={BUTTON} disabled={blocked} onClick={() => setCreating(!creating)} aria-expanded={creating} data-ourgeo-id="projectFiles.createFolder">Create linked folder…</button>
            <button type="button" className={BUTTON} disabled={blocked || !linked.length} onClick={() => run(() => store.rescanFolders())} data-ourgeo-id="projectFiles.rescanFolders">Rescan linked folders</button>
          </div>
          {creating && <form className="rounded border border-geo-border p-3 space-y-2" onSubmit={event => {
            event.preventDefault()
            if (!name.trim() || /[\\/]/.test(name) || ['.', '..'].includes(name.trim())) { setError('Choose a folder name without path separators, then choose its parent folder.'); return }
            run(async () => {
              const count = useProjectFilesStore.getState().catalogue.linkedFolders?.length ?? 0
              await store.createFolder(name.trim())
              if ((useProjectFilesStore.getState().catalogue.linkedFolders?.length ?? 0) > count) { setCreating(false); setName('') }
            })
          }}>
            <label className="block text-xs">New folder name<input autoFocus required value={name} onChange={event => setName(event.target.value)} aria-label="New folder name" className={`${CONTROL} block w-full mt-1`} data-ourgeo-id="projectFiles.newFolderName" /></label>
            <p className="text-xs">Choose a parent location next. ouRGeo creates this physical folder and links it to the project.</p>
            <div className="flex flex-wrap gap-2"><button type="submit" className={BUTTON} disabled={blocked || !name.trim()} data-ourgeo-id="projectFiles.createFolderConfirm">Choose parent and create folder…</button><button type="button" className={BUTTON} onClick={() => setCreating(false)}>Cancel creating folder</button></div>
          </form>}
          {error && <p className="text-xs whitespace-pre-wrap" role="alert">{error}</p>}
          {store.catalogue.notice && <p className="text-xs whitespace-pre-wrap" role="status">{store.catalogue.notice}</p>}
          {operation && <div className="flex items-center gap-2 text-xs" role="status"><span>{operation.label} · {operation.completed}/{operation.total}</span>{operation.cancellable && <button type="button" className={BUTTON} onClick={() => run(store.cancel)}>Cancel operation</button>}</div>}
          {!linked.length ? <p className="text-xs">No linked folders yet. Link an existing folder or create a new one in a location you choose.</p> : <div className="space-y-3">{linked.map(folder => <FolderCard key={folder.id} folder={folder} busy={blocked} run={run} forget={() => { setError(null); setForgetting(folder) }} />)}</div>}
          <p className="text-xs">Folder labels and file classifications organise this project. They do not rename or move files on disk. Remove a file to hide it from this project; Forget link removes the folder connection. Files on disk are kept.</p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    <Dialog.Root open={!!forgetting} onOpenChange={value => { if (!value) setForgetting(null) }}>
      <Dialog.Portal><Dialog.Overlay className="fixed inset-0 bg-geo-bg/80 z-[70]" /><Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[70] w-[calc(100%_-_2rem)] max-w-md rounded border border-geo-border bg-geo-panel text-foreground p-4 space-y-3">
        <Dialog.Title className="text-sm">Forget linked folder {forgetting?.name}?</Dialog.Title>
        <Dialog.Description className="text-xs">Files on disk are kept. This folder's files leave Project Files and the assistant loses access through this link.</Dialog.Description>
        {error && <p className="text-xs whitespace-pre-wrap" role="alert">{error}</p>}
        <div className="flex flex-wrap gap-2"><button type="button" className={BUTTON} autoFocus onClick={() => setForgetting(null)}>Cancel</button><button type="button" className={BUTTON} disabled={busy} onClick={() => { const id = forgetting?.id; if (id) run(async () => { await store.forgetFolder(id); setForgetting(null) }) }} data-ourgeo-id="projectFiles.forgetFolderConfirm">Forget linked folder</button></div>
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  </>
}
