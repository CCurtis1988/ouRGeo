import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowLeft, FilePlus2, MoreHorizontal, Search, X } from 'lucide-react'
import { useProjectFilesStore, initProjectFiles, INITIAL_PROJECT_FILE_FILTERS } from '@/store/project-files'
import { useProjectStore } from '@/store/project'
import { useContextStore } from '@/store/context'
import { projectFileSourceId, type ProjectFileEntry, type ProjectFileRole, type ProjectFileStatus } from '@/lib/project-files'
import { FILE_STATUS_LABELS, LINKED_FOLDER_STATUS_LABELS, fileSize, fileType, linkedFileAvailability, projectFileStorageTotals, visibleProjectFiles, type ProjectFileFilters, type ProjectFileSort } from '@/lib/project-files-ui'
import { usePanelId } from '@/components/layout/panel-context'
import { usePanelDrawsTabs } from '@/hooks/useZoneTabs'
import { ZoneTabs } from '@/components/layout/ZoneTabs'
import { cn } from '@/lib/utils'
import { PDFPagePreview } from './PDFPagePreview'
import { TablePreview } from './TablePreview'
import { LinkedFoldersDialog } from './LinkedFoldersDialog'

const CONTROL = 'rounded border border-geo-border bg-geo-bg px-2 py-1 text-xs text-foreground placeholder:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-geo-accent'
const BUTTON = `${CONTROL} hover:bg-geo-panel disabled:opacity-50 disabled:cursor-not-allowed`
const DEFAULT_FILTERS = INITIAL_PROJECT_FILE_FILTERS

function LocationChooser({ file }: { file: ProjectFileEntry }): React.ReactElement | null {
  const location = useProjectFilesStore(s => s.location)
  const kind = file.mediaType === 'application/pdf' ? 'pdf' : file.mediaType.includes('wordprocessingml') ? 'docx' : file.mediaType.includes('spreadsheetml') ? 'sheet' : /^text\//.test(file.mediaType) ? 'lines' : null
  const [start, setStart] = useState('1'), [end, setEnd] = useState('20'), [sheet, setSheet] = useState(''), [range, setRange] = useState('')
  useEffect(() => {
    setStart(location?.kind === 'pdf' ? String(location.page) : location?.kind === 'docx' ? String(location.section) : location?.kind === 'lines' ? String(location.start) : '1')
    setEnd(location?.kind === 'lines' ? String(location.end) : '20')
    setSheet(location?.kind === 'sheet' ? location.sheet : '')
    setRange(location?.kind === 'sheet' ? location.range ?? '' : '')
  }, [file.id, location])
  if (!kind) return null
  return <form className="flex flex-wrap items-end gap-2 text-xs" onSubmit={event => {
    event.preventDefault()
    const selected = kind === 'pdf' ? { kind: 'pdf' as const, page: Number(start) } : kind === 'docx' ? { kind: 'docx' as const, section: Number(start) } : kind === 'sheet' ? { kind: 'sheet' as const, sheet: sheet.trim(), ...(range.trim() ? { range: range.trim() } : {}) } : { kind: 'lines' as const, start: Number(start), end: Number(end) }
    useProjectFilesStore.getState().select([file.id], selected)
  }}>
    {kind === 'sheet' ? <><label>Sheet<input aria-label="Preview sheet" className={`${CONTROL} w-28 block`} value={sheet} required onChange={event => setSheet(event.target.value)} /></label><label>Cells<input aria-label="Preview cell range" className={`${CONTROL} w-24 block`} value={range} placeholder="A1:D20" onChange={event => setRange(event.target.value)} /></label></>
      : <><label>{kind === 'pdf' ? 'Page' : kind === 'docx' ? 'Section' : 'Start line'}<input aria-label={kind === 'pdf' ? 'Preview page' : kind === 'docx' ? 'Preview section' : 'Preview start line'} type="number" min="1" step="1" required className={`${CONTROL} w-20 block`} value={start} onChange={event => setStart(event.target.value)} /></label>{kind === 'lines' && <label>End line<input aria-label="Preview end line" type="number" min={start || 1} step="1" required className={`${CONTROL} w-20 block`} value={end} onChange={event => setEnd(event.target.value)} /></label>}</>}
    <button className={BUTTON} type="submit">Show selection</button>
    {location && <button className={BUTTON} type="button" onClick={() => useProjectFilesStore.getState().select([file.id])}>Clear selection</button>}
  </form>
}

function FileDetails({ file, narrow, back, run }: { file: ProjectFileEntry; narrow: boolean; back: () => void; run: (action: () => Promise<unknown>) => void }): React.ReactElement {
  const store = useProjectFilesStore()
  const [name, setName] = useState(file.name)
  const [description, setDescription] = useState(file.userDescription)
  const [folder, setFolder] = useState(file.folder)
  const [role, setRole] = useState(file.role)
  const [hiddenPreview, setHiddenPreview] = useState<{ id: string; enabled: boolean } | null>(null)
  const previewHidden = hiddenPreview?.id === file.id && hiddenPreview.enabled
  const exclusions = useContextStore(s => s.excluded)
  const exclusionsLoaded = useContextStore(s => s.exclusionsLoaded)
  const projectId = store.catalogue.projectId
  const sourceId = projectId ? projectFileSourceId(projectId, file.id) : ''
  const excluded = exclusions.includes(sourceId)
  const linkedFolder = store.catalogue.linkedFolders?.find(folder => folder.id === file.storage?.folderId)
  const access = linkedFileAvailability(file, store.catalogue.linkedFolders)
  const location = store.location, loadPreview = store.loadPreview
  useEffect(() => {
    setName(file.name); setDescription(file.userDescription); setFolder(file.folder); setRole(file.role)
  }, [file.id, file.name, file.userDescription, file.folder, file.role])
  useEffect(() => { void loadPreview(file.id, location, { includeHidden: previewHidden }) }, [file.id, file.revision, file.status, file.coverage, linkedFolder?.status, linkedFolder?.path, location, loadPreview, previewHidden])
  const changed = name !== file.name || description !== file.userDescription || folder !== file.folder || role !== file.role
  const preview = store.preview
  return (
    <section className="min-w-0 flex-1 overflow-auto p-3 space-y-3" aria-label={`Details for ${file.name}`}>
      <div className="flex items-center gap-2">
        <button type="button" className={BUTTON} onClick={back} aria-label={narrow ? 'Back to project files' : 'Close file details'}>
          {narrow ? <ArrowLeft className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
        </button>
        <h3 className="text-sm font-medium truncate">{file.name}</h3>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-foreground" aria-live="polite">
        <span>{file.storage ? file.saved ? 'Link saved in project' : 'Linked · Not saved' : file.saved ? 'Saved in project' : 'Added · Not saved'}</span>
        <span>{FILE_STATUS_LABELS[file.status]}</span>
        <span>{fileType(file)} · {fileSize(file.bytes)}</span>
      </div>
      {file.storage && <div className="rounded border border-geo-border p-2 text-xs space-y-1"><p className="font-medium">Linked · {linkedFolder?.name || 'Folder unavailable'} · {linkedFolder ? LINKED_FOLDER_STATUS_LABELS[linkedFolder.status] : 'Not linked'}</p><p className="break-all">{file.storage.relativePath}</p>{linkedFolder?.path && <p className="break-all">Folder on this device: {linkedFolder.path}</p>}<p>The original stays outside the project bundle. Display names and logical folders do not rename or move it on disk.</p>{access.reason && <p>{access.reason}</p>}{linkedFolder && linkedFolder.status !== 'ready' && <button type="button" className={BUTTON} onClick={() => run(() => store.relinkFolder(linkedFolder.id))}>Relink folder…</button>}</div>}
      {(file.issue || file.coverage) && <p className="text-xs text-foreground whitespace-pre-wrap">{file.issue || file.coverage}</p>}
      {file.descriptionNeedsReview && <p className="text-xs text-foreground">This file was replaced. Review its description and role before relying on them.</p>}
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2 text-xs space-y-1">Name<input aria-label="File name" className={`${CONTROL} w-full`} value={name} onChange={e => setName(e.target.value)} /></label>
        <label className="text-xs space-y-1">Folder<input aria-label="Logical folder" list="project-file-folders" placeholder="Project root" className={`${CONTROL} w-full`} value={folder} onChange={e => setFolder(e.target.value)} /></label>
        <label className="text-xs space-y-1">Role<select aria-label="File role" className={`${CONTROL} w-full`} value={role} onChange={e => setRole(e.target.value as ProjectFileRole)}><option value="reference">Reference</option><option value="standard">Standard</option><option value="example">Example</option></select></label>
        <label className="col-span-2 text-xs space-y-1">Your description<textarea aria-label="File description" className={`${CONTROL} w-full resize-y min-h-16`} value={description} onChange={e => setDescription(e.target.value)} placeholder="Explain what this file is useful for" /></label>
      </div>
      {file.generatedDescription && <p className="text-xs text-foreground"><span className="font-medium">Generated description: </span>{file.generatedDescription}</p>}
      <button type="button" className={BUTTON} disabled={!changed || !name.trim()} onClick={() => run(() => store.update(file.id, { name: name.trim(), userDescription: description, folder: folder.trim(), role }))}>Save details</button>
      <div className="space-y-1">
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={exclusionsLoaded && !excluded && access.available} onChange={() => run(() => useContextStore.getState().exclude(sourceId, 'project', projectId))} disabled={!projectId || !exclusionsLoaded || !access.available} />Available to the assistant</label>
        {!exclusionsLoaded && <p className="text-xs">Assistant access is paused while source preferences are unavailable. Reopen the assistant context settings to retry.</p>}
        {excluded && <p className="text-xs text-foreground">Excluded from assistant discovery and reading. You can still preview and export the file.</p>}
      </div>
      {file.mediaType.includes('spreadsheetml') && <div className="space-y-1"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={file.includeHidden === true} onChange={event => { const enabled = event.target.checked; run(() => store.setIncludeHidden(file.id, enabled)) }} />Include hidden workbook contents for the assistant</label><p className="text-xs">Hidden sheets, rows and columns are excluded by default. Changing this rebuilds searchable contents on this device.</p></div>}
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={BUTTON} disabled={excluded || !exclusionsLoaded || !access.available} onClick={() => window.dispatchEvent(new CustomEvent('ourgeo:attachProjectFile', { detail: { id: file.id, location } }))} data-ourgeo-id="projectFiles.attach">Attach to chat</button>
        {!file.storage && <button type="button" className={BUTTON} onClick={() => run(() => store.replace(file.id))}>Replace file…</button>}
        <button type="button" className={BUTTON} onClick={() => run(() => store.exportFile(file.id))}>Export original…</button>
        <button type="button" className={BUTTON} onClick={() => run(() => store.reindex([file.id]))}>Reindex file</button>
      </div>
      <p className="text-xs text-foreground">{file.storage ? 'Preview is read-only. Edit the original in its linked folder, then rescan the folder to refresh Project Files.' : 'Preview is read-only. To edit elsewhere, export the original, edit it and choose Replace file.'}</p>
      <div className="border-t border-geo-border pt-2">
        <h4 className="text-xs font-medium mb-2">Preview</h4>
        {file.mediaType.includes('spreadsheetml') && <div className="space-y-1 mb-2"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={previewHidden} onChange={event => setHiddenPreview({ id: file.id, enabled: event.target.checked })} />Show hidden contents in preview</label>{previewHidden && <p className="text-xs">Hidden contents are shown only in this preview. Assistant access is controlled separately above.</p>}</div>}
        <LocationChooser file={file} />
        {!preview ? <div className="space-y-2"><p className="text-xs text-foreground">{store.error ? 'The preview could not load. Retry the preview or export the original file.' : 'Loading preview…'}</p>{store.error && <button type="button" className={BUTTON} onClick={() => run(() => loadPreview(file.id, location, { includeHidden: previewHidden }))}>Retry preview</button>}</div>
          : preview.kind === 'table' && preview.table ? <TablePreview file={file} table={preview.table} />
          : preview.kind === 'image' && preview.url ? <img src={preview.url} alt={`Preview of ${file.name}`} className="max-w-full max-h-96 object-contain" />
            : preview.kind === 'pdf' && preview.url ? <><PDFPagePreview url={preview.url} name={file.name} page={location?.kind === 'pdf' ? location.page : 1} onPage={page => store.select([file.id], { kind: 'pdf', page })} /><details className="text-xs mt-2"><summary>Extracted text</summary><pre className="whitespace-pre-wrap break-words font-mono">{preview.text || 'No extractable text is available for this page.'}</pre></details></>
              : preview.kind === 'stored' ? <p className="text-xs text-foreground">A preview is unavailable for this format. Export the original to open it in another application.</p>
                : <pre className="text-xs whitespace-pre-wrap break-words font-mono">{preview.text || 'No extractable text is available.'}</pre>}
        {preview && <p className="text-xs text-foreground mt-2">{preview.coverage}{!preview.complete && ' Preview is bounded; additional contents may be available.'}</p>}
      </div>
      <p className="text-xs text-foreground">Imported {new Date(file.importedAt).toLocaleString()}<br />Updated {new Date(file.updatedAt).toLocaleString()}</p>
    </section>
  )
}

export function ProjectFilesPanel(): React.ReactElement {
  const panel = usePanelId('projectFiles'), drawsTabs = usePanelDrawsTabs(panel)
  const store = useProjectFilesStore()
  const projectPath = useProjectStore(s => s.path)
  const exclusions = useContextStore(s => s.excluded)
  const filters = store.filters, setFilters = store.setFilters
  const [menu, setMenu] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [linkedFoldersOpen, setLinkedFoldersOpen] = useState(false)
  const [narrow, setNarrow] = useState(true)
  const [dropping, setDropping] = useState(false)
  const [multiple, setMultiple] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null), list = useRef<HTMLDivElement>(null)
  const menuWrap = useRef<HTMLDivElement>(null)
  const anchor = useRef<string | null>(null)
  const selectedFile = store.catalogue.files.find(file => file.id === store.selected[0])
  const excludedIds = useMemo(() => new Set(store.catalogue.files.filter(file => exclusions.includes(projectFileSourceId(store.catalogue.projectId ?? '', file.id)) || !linkedFileAvailability(file, store.catalogue.linkedFolders).available).map(file => file.id)), [store.catalogue, exclusions])
  const files = useMemo(() => visibleProjectFiles(store.catalogue.files, filters, excludedIds), [store.catalogue.files, filters, excludedIds])
  const folders = [...new Set(store.catalogue.files.map(file => file.folder).filter(Boolean))].sort()
  const virtual = useVirtualizer({ count: files.length, getScrollElement: () => list.current, estimateSize: () => 49, overscan: 8 })
  const patch = (changes: Partial<ProjectFileFilters>): void => setFilters(changes)
  const run = (action: () => Promise<unknown>): void => {
    setActionError(null)
    void Promise.resolve().then(action).catch(error => setActionError(`${error instanceof Error ? error.message : String(error)} Retry the action.`))
  }
  useEffect(() => { initProjectFiles() }, [])
  useEffect(() => {
    if (!root.current) return
    const observer = new ResizeObserver(entries => setNarrow(entries[0].contentRect.width < 760))
    observer.observe(root.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => { setConfirmRemove(false); setActionError(null) }, [store.catalogue.projectId])
  useEffect(() => {
    if (!menu) return
    const close = (event: MouseEvent): void => { if (!menuWrap.current?.contains(event.target as Node)) setMenu(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])
  function choose(id: string, extend = false, toggle = false): void {
    if (extend && anchor.current) {
      const start = files.findIndex(file => file.id === anchor.current), end = files.findIndex(file => file.id === id)
      store.select(files.slice(Math.min(start < 0 ? end : start, end), Math.max(start, end) + 1).map(file => file.id), undefined, false)
    } else {
      anchor.current = id
      store.select(toggle ? store.selected.includes(id) ? store.selected.filter(selected => selected !== id) : [...store.selected, id] : [id], undefined, !narrow)
    }
  }
  function keyDown(event: React.KeyboardEvent): void {
    const current = files.findIndex(file => file.id === store.selected.at(-1))
    let next = current
    if (event.key === 'ArrowDown') next = Math.min(files.length - 1, current + 1)
    else if (event.key === 'ArrowUp') next = Math.max(0, current - 1)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = files.length - 1
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); store.select(files.map(file => file.id), undefined, false); return }
    else if (event.key === 'Enter' && store.selected.length === 1) { event.preventDefault(); store.select(store.selected); return }
    else if (event.key === ' ' && files[current]) { event.preventDefault(); choose(files[current].id, false, true); return }
    else if (event.key === 'Delete' && store.selected.length) { event.preventDefault(); setConfirmRemove(true); return }
    else if (event.key === 'Escape') { store.select([]); return }
    else return
    event.preventDefault()
    if (files[next]) { choose(files[next].id, event.shiftKey); virtual.scrollToIndex(next) }
  }
  const operation = store.catalogue.operation
  const details = selectedFile && store.selected.length === 1 && store.detailsOpen
  const totals = projectFileStorageTotals(store.catalogue.files)
  return (
    <div ref={root} tabIndex={-1} className={cn('relative h-full min-h-0 flex flex-col bg-geo-panel text-foreground', dropping && 'outline outline-2 outline-geo-accent -outline-offset-2')}
      onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDropping(true) } }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropping(false) }}
      onDrop={event => { event.preventDefault(); setDropping(false); const paths = Array.from(event.dataTransfer.files).map(file => window.electronAPI.projectFiles.pathForFile(file)).filter(Boolean); if (paths.length) run(() => store.add(paths)) }} data-ourgeo-id="projectFiles.panel">
      <div className="flex items-center gap-2 border-b border-geo-border px-1.5 py-1 flex-shrink-0 flex-wrap">
        {drawsTabs ? <ZoneTabs panel={panel} className="shrink-0" /> : <h2 className="text-xs font-medium">Project Files</h2>}
        <button className={BUTTON} type="button" onClick={() => run(() => store.add())} disabled={!!operation} title={projectPath ? 'Add files to this project' : 'Save project to add files'} data-ourgeo-id="projectFiles.add"><FilePlus2 className="inline w-3.5 h-3.5 mr-1" />{projectPath ? 'Add files' : 'Save project to add files'}</button>
        <button className={BUTTON} type="button" onClick={() => setLinkedFoldersOpen(true)} data-ourgeo-id="projectFiles.linkedFolders">Linked folders</button>
        <label className="relative min-w-28 flex-1"><Search className="absolute left-2 top-1.5 w-3 h-3 text-foreground" /><input aria-label="Search project files" value={filters.search} onChange={event => patch({ search: event.target.value })} className={`${CONTROL} w-full pl-6`} placeholder="Search project files" data-ourgeo-id="projectFiles.search" /></label>
        <div ref={menuWrap} className="relative">
          <button className={BUTTON} type="button" aria-label="Project files actions" aria-expanded={menu} onClick={() => setMenu(!menu)} data-ourgeo-id="projectFiles.menu"><MoreHorizontal className="w-4 h-4" /></button>
          {menu && <div className="absolute right-0 top-full mt-1 p-1 z-30 bg-geo-panel border border-geo-border rounded shadow-xl w-48" onKeyDown={event => { if (event.key === 'Escape') setMenu(false) }}>
            <button type="button" className={`${BUTTON} w-full text-left mb-1`} onClick={() => { setMenu(false); run(() => store.reindex()) }} disabled={!!operation || !store.catalogue.files.length} data-ourgeo-id="projectFiles.reindex">Reindex project files</button>
            <button type="button" className={`${BUTTON} w-full text-left`} onClick={() => { setMenu(false); run(store.refresh) }}>Refresh library</button>
            {store.catalogue.recoveries?.map(recovery => <button key={recovery.id} type="button" className={`${BUTTON} w-full text-left mt-1`} onClick={() => { setMenu(false); run(() => store.recover(recovery.id)) }} title={`${recovery.label} · ${recovery.files} files`}>Recover file draft as new project…<span className="block text-xs">{recovery.label} · {recovery.files} files</span></button>)}
          </div>}
        </div>
      </div>
      {(actionError || store.error || store.notice || store.catalogue.notice) && <p className="px-3 py-1 text-xs text-foreground border-b border-geo-border whitespace-pre-wrap" role={actionError || store.error ? 'alert' : 'status'}>{actionError || store.error || store.notice || store.catalogue.notice}</p>}
      {operation && <div className="flex items-center gap-2 px-3 py-1 text-xs border-b border-geo-border" role="status"><span>{operation.label} · {operation.completed}/{operation.total}</span><progress aria-label={operation.label} value={operation.completed} max={operation.total || 1} className="flex-1" />{operation.cancellable && <button className={BUTTON} type="button" onClick={() => run(store.cancel)}>Cancel</button>}</div>}
      <div className="flex flex-1 min-h-0">
        {(!narrow || !details) && <div className={cn('flex flex-col min-h-0 min-w-0', details ? 'w-1/2 border-r border-geo-border' : 'flex-1')}>
          <div className="flex gap-1 px-2 py-1 border-b border-geo-border overflow-x-auto flex-shrink-0 [&>select]:shrink-0 [&>select]:max-w-40 [&>button]:shrink-0 [&>button]:whitespace-nowrap">
            <select aria-label="Filter by location" className={CONTROL} value={filters.location} onChange={event => patch({ location: event.target.value })}><option value="">All locations</option><option value="embedded">In project</option>{store.catalogue.linkedFolders?.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select>
            <select aria-label="Filter by folder" className={CONTROL} value={filters.folder} onChange={event => patch({ folder: event.target.value })}><option value="">All folders</option>{folders.map(folder => <option key={folder} value={folder}>{folder}</option>)}</select>
            <select aria-label="Filter by role" className={CONTROL} value={filters.role} onChange={event => patch({ role: event.target.value as ProjectFileRole | '' })}><option value="">All roles</option><option value="reference">Reference</option><option value="standard">Standard</option><option value="example">Example</option></select>
            <select aria-label="Filter by status" className={CONTROL} value={filters.status} onChange={event => patch({ status: event.target.value as ProjectFileStatus | '' })}><option value="">All statuses</option>{Object.entries(FILE_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <select aria-label="Filter by assistant availability" className={CONTROL} value={filters.availability} onChange={event => patch({ availability: event.target.value as ProjectFileFilters['availability'] })}><option value="">All availability</option><option value="available">Available to assistant</option><option value="excluded">Unavailable to assistant</option></select>
            <select aria-label="Sort files" className={CONTROL} value={filters.sort} onChange={event => patch({ sort: event.target.value as ProjectFileSort })}><option value="name">Name</option><option value="type">Type</option><option value="description">Description</option><option value="status">Status</option></select>
            <button className={BUTTON} type="button" onClick={() => patch({ descending: !filters.descending })} aria-label={filters.descending ? 'Sort ascending' : 'Sort descending'}>{filters.descending ? '↓' : '↑'}</button>
            <button className={BUTTON} type="button" aria-pressed={multiple} onClick={() => setMultiple(!multiple)}>Select multiple</button>
            {multiple && <button className={BUTTON} type="button" onClick={() => store.select(files.map(file => file.id), undefined, false)}>Select all shown</button>}
          </div>
          {store.selected.length > 0 && <div className="flex items-center gap-2 px-2 py-1 border-b border-geo-border text-xs overflow-x-auto flex-shrink-0 whitespace-nowrap [&>button]:shrink-0"><span>{store.selected.length} selected</span>{store.selected.length === 1 && <button type="button" className={BUTTON} onClick={() => store.select(store.selected)}>Preview / details</button>}<button type="button" className={BUTTON} onClick={() => run(() => store.reindex(store.selected))}>Reindex selected</button><button type="button" className={BUTTON} onClick={() => setConfirmRemove(true)}>Remove…</button><button type="button" className={BUTTON} onClick={() => store.select([])}>Clear selection</button></div>}
          {!store.catalogue.files.length ? <div className="p-4 text-xs text-foreground space-y-2"><p>{store.loading ? 'Loading project files…' : 'Keep reports, standards and examples with this project. Add files to make them available when needed.'}</p>{!projectPath && <p>Save a named project before adding files.</p>}<p>Drop files here or choose Add files. Imports stay on this device until you use the assistant.</p></div>
            : !files.length ? <p className="p-4 text-xs text-foreground">No files match these filters. <button type="button" className={BUTTON} onClick={() => setFilters(DEFAULT_FILTERS)}>Clear filters</button></p>
              : <><div className={cn('grid gap-x-3 px-3 py-1 border-b border-geo-border text-xs font-medium', !narrow && !details ? 'grid-cols-[minmax(100px,1fr)_64px_minmax(100px,1fr)_128px]' : 'grid-cols-[minmax(100px,1fr)_minmax(80px,.7fr)]')}><span>Name / description</span>{!narrow && !details && <><span>Type</span><span>Description</span></>}<span>Status</span></div><div ref={list} className="flex-1 min-h-20 overflow-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-geo-accent" role="listbox" aria-label="Project files" aria-multiselectable="true" aria-activedescendant={store.selected.length ? `project-file-${store.selected.at(-1)}` : undefined} tabIndex={0} onKeyDown={keyDown}>
                <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
                  {virtual.getVirtualItems().map(row => { const file = files[row.index]; return <div key={file.id} id={`project-file-${file.id}`} role="option" aria-selected={store.selected.includes(file.id)} aria-setsize={files.length} aria-posinset={row.index + 1} onClick={event => choose(file.id, event.shiftKey, multiple || event.ctrlKey || event.metaKey)} onDoubleClick={() => store.select([file.id])}
                    className={cn('absolute left-0 top-0 w-full grid items-center gap-x-3 px-3 border-b border-geo-border cursor-pointer text-xs', !narrow && !details ? 'grid-cols-[minmax(100px,1fr)_64px_minmax(100px,1fr)_128px]' : 'grid-cols-[minmax(100px,1fr)_minmax(80px,.7fr)]', store.selected.includes(file.id) ? 'bg-geo-bg outline outline-1 -outline-offset-1 outline-geo-accent' : 'hover:bg-geo-bg')}
                    style={{ height: row.size, transform: `translateY(${row.start}px)` }}>
                    <div className="min-w-0"><div className="truncate font-medium">{store.selected.includes(file.id) ? '✓ ' : ''}{file.name}{file.storage && <span className="ml-1 font-normal">· Linked</span>}</div><div className="truncate text-foreground">{file.userDescription || file.generatedDescription || file.folder || fileType(file)}</div></div>
                    {!narrow && !details && <><span className="truncate">{fileType(file)}</span><span className="truncate">{file.userDescription || file.generatedDescription || 'No description'}</span></>}
                    <div className="min-w-0"><div className="truncate">{FILE_STATUS_LABELS[file.status]}</div><div className="truncate">{excludedIds.has(file.id) ? 'Unavailable to assistant' : !file.saved ? 'Not saved' : file.storage ? 'External original' : fileType(file)}</div></div>
                  </div> })}
                </div>
              </div></>}
        </div>}
        {details && <FileDetails file={selectedFile} narrow={narrow} back={() => { store.select([]); requestAnimationFrame(() => list.current?.focus()) }} run={run} />}
      </div>
      <datalist id="project-file-folders">{folders.map(folder => <option key={folder} value={folder} />)}</datalist>
      <footer className="flex items-center flex-wrap gap-2 px-3 py-1 text-xs border-t border-geo-border text-foreground" aria-live="polite"><span>In project: {totals.embedded.count} files · {fileSize(totals.embedded.bytes)}</span>{(totals.linked.count > 0 || !!store.catalogue.linkedFolders?.length) && <span>Linked: {totals.linked.count} files · {fileSize(totals.linked.bytes)} external</span>}<span>{!projectPath ? 'Save project to add files' : store.catalogue.revision !== store.catalogue.savedRevision ? 'Changes not saved' : 'Saved in project'}</span>{store.undoAvailable && <button type="button" className={BUTTON} onClick={() => run(store.undo)}>Undo removal</button>}</footer>
      <LinkedFoldersDialog open={linkedFoldersOpen} onOpenChange={setLinkedFoldersOpen} />
      <Dialog.Root open={confirmRemove} onOpenChange={setConfirmRemove}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-geo-bg/80 z-[60]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[60] max-w-sm w-[calc(100%-2rem)] border border-geo-border rounded p-4 bg-geo-panel text-foreground space-y-3">
            <Dialog.Title className="text-sm">Remove {store.selected.length} {store.selected.length === 1 ? 'file' : 'files'} from this project?</Dialog.Title>
            <Dialog.Description className="text-xs">Original files on disk are kept. You can undo removal until the project is saved or closed.</Dialog.Description>
            <div className="flex gap-2"><button autoFocus type="button" className={BUTTON} onClick={() => setConfirmRemove(false)}>Cancel</button><button type="button" className={BUTTON} onClick={() => { const ids = [...store.selected]; setConfirmRemove(false); run(() => store.remove(ids)) }}>Remove from project</button></div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
