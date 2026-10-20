import React from 'react'
import { FolderOpen, Package } from 'lucide-react'
import { useProjectStore } from '@/store/project'

export type ExportTarget = 'disk' | 'project'

interface Props {
  target: ExportTarget
  onTargetChange: (target: ExportTarget) => void
  /** Logical folder in Project Files ("figures", "tables"). */
  folder: string
  onFolderChange: (folder: string) => void
  /** The dialog's own directory picker, shown when saving to disk. */
  children: React.ReactNode
  /** Small-caps label, matching the dialog it sits in. */
  labelClassName?: string
}

/**
 * "Save to" for every export dialog: a folder on disk, or this project's
 * Project Files. Shared so the choice reads the same wherever a chart or table
 * is exported, and so the scratch rule is stated once — scratch has no file
 * library, and an option that is offered and then refused at the end of the
 * export is worse than one that says up front why it is unavailable.
 */
export function ExportDestinationField({ target, onTargetChange, folder, onFolderChange, children, labelClassName }: Props): React.ReactElement {
  const named = useProjectStore(s => s.path !== null)
  const label = labelClassName ?? 'text-xs text-geo-muted font-medium uppercase tracking-wide'
  const option = (active: boolean): string => `flex flex-1 items-center justify-center gap-1 px-2 py-1 text-xs border rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${active
    ? 'border-geo-accent bg-geo-accent/10 text-geo-accent'
    : 'border-geo-border text-geo-muted hover:text-foreground hover:border-geo-muted'}`
  const project = target === 'project' && named
  return (
    <div className="flex flex-col gap-1.5" data-ourgeo-id="export.destination">
      <span className={label}>Save to</span>
      <div className="flex gap-1" role="radiogroup" aria-label="Export destination">
        <button type="button" role="radio" aria-checked={!project} className={option(!project)} onClick={() => onTargetChange('disk')}>
          <FolderOpen className="w-3 h-3" />Folder
        </button>
        <button type="button" role="radio" aria-checked={project} disabled={!named} className={option(project)} onClick={() => onTargetChange('project')}
          title={named ? 'Save into this project’s Project Files' : 'Save the project first — the scratch workspace has no Project Files'}>
          <Package className="w-3 h-3" />Project Files
        </button>
      </div>
      {project ? (
        <>
          <input type="text" value={folder} onChange={e => onFolderChange(e.target.value)} placeholder="Folder (optional)" aria-label="Project Files folder"
            className="w-full bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground placeholder-geo-muted focus:outline-none focus:border-geo-accent" />
          <span className="text-[10px] text-geo-muted leading-snug">Saved through <code>ourgeo_project_path()</code>. Save the project to keep it in the bundle.</span>
        </>
      ) : children}
      {!named && <span className="text-[10px] text-geo-muted leading-snug">Save the project to export into Project Files.</span>}
    </div>
  )
}
