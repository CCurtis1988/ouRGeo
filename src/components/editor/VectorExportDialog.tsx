import { useCallback, useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, FolderOpen, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DataChecksPanel } from '@/components/toolbox/DataChecksPanel'
import { executeChecked, inspectRequest } from '@/lib/data-preflight'
import { vectorExportRequest, type VectorExportOptions } from '@/lib/vector-export'
import type { PreflightReport } from '@/lib/data-preflight-types'
import { useSelectionStore } from '@/store/selection'
import { useProjectStore } from '@/store/project'
import { useProjectFilesStore } from '@/store/project-files'
import { confirmProjectFileReplace } from '@/store/project-file-replace'
import { projectFileName } from '@/lib/project-file-code'
import { formatProjectFileTarget } from '@/lib/project-file-targets'
import { ExportDestinationField, type ExportTarget } from '@/components/project/ExportDestinationField'

interface Props { name: string; envName: string; accessPath: string; fields: string[]; onClose: () => void }
export function VectorExportDialog({ name, envName, accessPath, fields, onClose }: Props) {
  const [options, setOptions] = useState<VectorExportOptions>({ format: 'gpkg', path: '', layer: name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^[^a-zA-Z]/, 'layer_').slice(0, 63) || 'layer', mode: 'new', precision: '15', omitFields: '', textFields: '' })
  const [selected, setSelected] = useState(false)
  const [report, setReport] = useState<PreflightReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [saved, setSaved] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const [target, setTarget] = useState<ExportTarget>('disk')
  const [projectFolder, setProjectFolder] = useState('data')
  const [projectGpkg, setProjectGpkg] = useState('')
  const projectNamed = useProjectStore(s => s.path !== null)
  const toProject = target === 'project' && projectNamed
  // Adding or replacing a layer updates a GeoPackage already in the project;
  // a new file is named after the layer, like the other dialogs name theirs.
  const projectGpkgs = useProjectFilesStore(s => s.catalogue.files).filter(file => !file.storage && /\.gpkg$/i.test(file.name)).map(formatProjectFileTarget)
  let projectFile: string | undefined, nameError = ''
  if (toProject) {
    if (options.mode !== 'new') projectFile = projectGpkg || undefined
    else try { projectFile = projectFileName(projectFolder, `${options.layer}.${options.format}`) } catch (e) { nameError = e instanceof Error ? e.message : String(e) }
  }
  const revision = useSelectionStore(s => s.revision)
  const rows = useSelectionStore(s => s.selections[`${accessPath}::${envName}`]) ?? []
  const request = vectorExportRequest({ name, envName, accessPath, selectionVersion: revision, ...(selected ? { rows } : {}) }, toProject ? { ...options, path: '', projectFile } : options)
  const key = JSON.stringify(request)
  const currentKey = useRef(key); currentKey.current = key
  const invalidate = useCallback(() => { generation.current++; abort.current?.abort() }, [])
  useEffect(() => { invalidate(); setReport(null); setMessage(''); setSaved(false); return invalidate }, [key, invalidate])
  const change = (field: keyof VectorExportOptions, value: string) => setOptions(o => ({ ...o, [field]: value }))
  async function save() {
    // A new file replaces a project file of the same name; ask before that.
    // Adding or replacing a layer is an update the checks already review.
    if (toProject && options.mode === 'new' && projectFile && !await confirmProjectFileReplace(projectFile)) return
    const serial = ++generation.current
    const controller = new AbortController(); abort.current = controller
    setBusy(true); setMessage('')
    const update = (next: PreflightReport) => { if (generation.current === serial) setReport(next) }
    try {
      const checked = report && ['ready', 'needs_confirmation'].includes(report.status) ? report : await inspectRequest(request, update, controller.signal)
      const result = await executeChecked(checked, () => currentKey.current === key, update, controller.signal)
      if (generation.current === serial) { setSaved(result.success); setMessage(result.success ? `Saved and verified ${result.featureCount} features to ${result.path}.` : result.error ?? 'Export did not complete; check again.') }
    } catch (e) { if (generation.current === serial) setMessage(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const fieldChoice = (field: string) => options.omitFields.split(',').includes(field) ? 'omit' : options.textFields.split(',').includes(field) ? 'text' : 'keep'
  function chooseField(field: string, choice: string) {
    setOptions(o => ({ ...o,
      omitFields: [...o.omitFields.split(',').filter(f => f && f !== field), ...(choice === 'omit' ? [field] : [])].join(','),
      textFields: [...o.textFields.split(',').filter(f => f && f !== field), ...(choice === 'text' ? [field] : [])].join(',') }))
  }
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" /><Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[min(720px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-geo-border bg-geo-panel text-foreground shadow-xl">
    <div className="flex flex-shrink-0 items-center justify-between border-b border-geo-border p-4"><Dialog.Title className="font-semibold">Export vector layer</Dialog.Title><Dialog.Close asChild><Button variant="ghost" size="icon" aria-label="Close vector export"><X className="h-4 w-4" /></Button></Dialog.Close></div>
    <Dialog.Description className="flex-shrink-0 px-4 pt-3 text-xs text-geo-muted">Save {name} to a local GIS file or into Project Files. Your source stays intact; staged output is reopened and verified before saving.</Dialog.Description>
    <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4 text-xs">
      <fieldset disabled={busy} className="space-y-3 disabled:opacity-70">
        <div className="grid grid-cols-2 gap-3"><label>Format<select aria-label="Export format" className="mt-1 w-full rounded border border-geo-border bg-geo-bg p-2" value={options.format} onChange={e => setOptions(o => ({ ...o, format: e.target.value as VectorExportOptions['format'], path: '', mode: 'new' }))}><option value="gpkg">GeoPackage · preserve supported content</option><option value="geojson">GeoJSON · RFC 7946 interchange</option></select></label>
          <label>Destination mode<select aria-label="Destination mode" className="mt-1 w-full rounded border border-geo-border bg-geo-bg p-2" value={options.mode} onChange={e => change('mode', e.target.value)}><option value="new">{toProject ? 'New file (replaces one of that name)' : 'New file'}</option>{options.format === 'gpkg' && <option value="add">{toProject ? 'Add layer to a project GeoPackage' : 'Add layer to existing GeoPackage'}</option>}{(!toProject || options.format === 'gpkg') && <option value="replace">{options.format === 'gpkg' ? 'Replace named layer' : 'Replace existing file'}</option>}</select></label></div>
        <ExportDestinationField target={target} labelClassName="" folder={projectFolder} onFolderChange={setProjectFolder}
          onTargetChange={next => { setTarget(next); if (next === 'project' && options.format === 'geojson' && options.mode !== 'new') change('mode', 'new') }}>
          <label className="block">Destination file<div className="mt-1 flex gap-2"><input aria-label="Destination file" className="min-w-0 flex-1 rounded border border-geo-border bg-geo-bg p-2" placeholder="Absolute local path" value={options.path} onChange={e => change('path', e.target.value)} /><Button variant="outline" size="sm" aria-label="Browse export destination" onClick={async () => { const path = await window.electronAPI.dialog.saveExportFile(options.format, options.mode !== 'new'); if (path) change('path', path) }}><FolderOpen className="h-4 w-4" /></Button></div></label>
        </ExportDestinationField>
        {toProject && options.mode === 'new' && <p className="text-geo-muted">{projectFile ? <>Saved as <span className="font-mono">{projectFile}</span>, named after the layer.</> : nameError}</p>}
        {toProject && options.mode !== 'new' && <label className="block">Project GeoPackage<select aria-label="Project GeoPackage" className="mt-1 w-full rounded border border-geo-border bg-geo-bg p-2" value={projectGpkg} onChange={e => setProjectGpkg(e.target.value)}>
          <option value="">{projectGpkgs.length ? 'Choose a GeoPackage in Project Files…' : 'No GeoPackage in Project Files yet — choose New file'}</option>
          {projectGpkgs.map(file => <option key={file} value={file}>{file}</option>)}
        </select></label>}
        <div className="grid grid-cols-2 gap-3"><label>Layer name<input aria-label="Export layer name" className="mt-1 w-full rounded border border-geo-border bg-geo-bg p-2" value={options.layer} onChange={e => change('layer', e.target.value)} /></label>
          {options.format === 'geojson' && <label>Coordinate decimal places<input type="number" min={0} max={15} aria-label="Coordinate decimal places" className="mt-1 w-full rounded border border-geo-border bg-geo-bg p-2" value={options.precision} onChange={e => change('precision', e.target.value)} /></label>}</div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={selected} disabled={!rows.length} onChange={e => setSelected(e.target.checked)} />Export current selection only ({rows.length} source rows)</label>
        <details><summary className="cursor-pointer">Attribute preservation choices</summary><p className="my-2 text-geo-muted">Keep preserves supported types. Unsupported fields block. Text conversion or omission requires a specific review.</p><div className="max-h-40 space-y-1 overflow-auto">{fields.map(field => <label key={field} className="flex items-center justify-between gap-3"><span className="truncate">{field}</span><select aria-label={`Export field ${field}`} className="rounded border border-geo-border bg-geo-bg p-1" value={fieldChoice(field)} onChange={e => chooseField(field, e.target.value)}><option value="keep">Keep type and values</option><option value="text">Convert supported scalar to text</option><option value="omit">Omit from export</option></select></label>)}</div></details>
      </fieldset>
      <DataChecksPanel request={request} activeReport={report} onReport={next => { setReport(next); if (next?.status === 'checking') { setMessage(''); setSaved(false) } }} onCancel={() => abort.current?.abort()} />
      {message && <p role={saved ? 'status' : 'alert'} className="whitespace-pre-wrap break-words">{message}</p>}
    </div>
    <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-geo-border p-3"><Button variant="outline" onClick={() => { abort.current?.abort(); if (!busy) onClose() }}>{busy ? 'Cancel export' : 'Close'}</Button><Button data-ourgeo-id="dataViewer.exportVector.save" disabled={busy || saved || !(toProject ? projectFile : options.path) || report?.status === 'blocked' || report?.status === 'checking'} onClick={() => void save()}><Save className="mr-1 h-4 w-4" />{busy ? 'Checking and saving…' : 'Check and save'}</Button></div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>
}
