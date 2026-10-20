import React, { useState, useRef, useEffect } from 'react'
import { ChevronDown, Save, SaveAll, FilePlus, FolderOpen, RotateCcw, HardDrive, FileClock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSessionStore } from '@/store/session'
import { useProjectStore } from '@/store/project'
import { saveCurrentProject, saveProjectAs, revertProject } from '@/lib/project-persistence'
import { switchProject } from '@/lib/project-leave'
import { useDraftStatus } from '@/lib/project-draft'
import { openProjectFiles } from '@/lib/project-files-ui'
import { useRecentlyClosedStore } from '@/store/recently-closed'
import { openRecentlyClosed, refreshRecentlyClosedExistence } from '@/lib/recently-closed-open'

// R connection status → the small dot color on the dropdown trigger (this
// replaces the old standalone "R Connected" indicator).
const STATUS_COLOR: Record<string, string> = {
  connecting: 'bg-yellow-500',
  ready: 'bg-geo-success',
  error: 'bg-geo-error',
  disconnected: 'bg-geo-muted',
}
const STATUS_LABEL: Record<string, string> = {
  connecting: 'R connecting…',
  ready: 'R connected',
  error: 'R error',
  disconnected: 'R disconnected',
}

export function ProjectDropdown(): React.ReactElement {
  const rStatus = useSessionStore((s) => s.rStatus)
  const name = useProjectStore((s) => s.name)
  const path = useProjectStore((s) => s.path)
  const isDirty = useProjectStore((s) => s.isDirty)
  const restored = useProjectStore((s) => s.restored)
  const recents = useProjectStore((s) => s.recents)
  const draftChanged = useDraftStatus((s) => s.changed)
  const recentlyClosed = useRecentlyClosedStore((s) => s.items)
  const missing = useRecentlyClosedStore((s) => s.missing)
  const isScratch = path === null
  // "Kept on this computer" — the words that matter on a shared drive, where
  // colleagues opening the file see none of it (§1.7).
  const keptLocally = !isScratch && (draftChanged || isDirty)

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (open) void refreshRecentlyClosedExistence() }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function run(action: () => Promise<unknown>): void {
    setOpen(false)
    setBusy(true)
    void action().finally(() => setBusy(false))
  }

  // Every switch leaves the current workspace first (lib/project-leave.tsx):
  // a named project's work goes to its draft, scratch offers Save as project.
  const onSave = (): void => run(saveCurrentProject)
  const onSaveAs = (): void => run(saveProjectAs)
  const onNew = (): void => run(() => switchProject({ kind: 'scratch' }))
  const onLoad = (): void => run(() => switchProject({ kind: 'pick' }))
  const onRecent = (path: string): void => run(() => switchProject({ kind: 'open', path }))
  const onRevert = (): void => run(revertProject)

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        title={STATUS_LABEL[rStatus] ?? rStatus}
        data-ourgeo-id="project.dropdown"
        data-restored={restored ? 'true' : 'false'}
        className={cn(
          'flex items-center gap-1.5 h-6 px-2 rounded text-xs transition-colors',
          'text-geo-muted hover:text-foreground hover:bg-white/5',
          open && 'bg-white/5 text-foreground',
          busy && 'opacity-60 cursor-wait',
        )}
      >
        <span className={cn('w-2 h-2 rounded-full flex-shrink-0', STATUS_COLOR[rStatus] ?? 'bg-geo-muted')} />
        <span className="max-w-[10rem] truncate text-foreground">{name}</span>
        {keptLocally && <span className="text-geo-muted" title="Unsaved changes, kept on this computer">•</span>}
        <ChevronDown className="w-3 h-3 flex-shrink-0" />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 z-50 w-64 bg-geo-panel border border-geo-border rounded-lg shadow-xl overflow-hidden">
          {keptLocally && (
            <p data-ourgeo-id="project.keptLocally" className="flex items-start gap-1.5 px-3 py-2 text-[11px] leading-snug text-geo-muted border-b border-geo-border">
              <HardDrive className="w-3.5 h-3.5 mt-px shrink-0" />
              <span>Unsaved changes, kept on this computer. Save to put them in the project file.</span>
            </p>
          )}
          <MenuItem
            icon={<Save className="w-3.5 h-3.5" />}
            label="Save"
            onClick={onSave}
            disabled={isScratch}
            title={isScratch ? 'The scratch project can’t be saved — use Save As' : undefined}
          />
          <MenuItem icon={<SaveAll className="w-3.5 h-3.5" />} label="Save As…" onClick={onSaveAs} />
          <button
            type="button"
            data-ourgeo-id="project.revert"
            onClick={onRevert}
            disabled={!keptLocally}
            title={isScratch ? 'Scratch has no saved version' : keptLocally ? 'Discard the unsaved changes kept on this computer' : 'Nothing differs from the saved project'}
            className={cn('w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors', keptLocally ? 'text-foreground hover:bg-white/5' : 'text-geo-muted/50 cursor-not-allowed')}
          >
            <span className="text-geo-muted"><RotateCcw className="w-3.5 h-3.5" /></span>
            Revert to Saved…
          </button>
          <MenuItem icon={<FilePlus className="w-3.5 h-3.5" />} label="New" onClick={onNew} />
          <MenuItem icon={<FolderOpen className="w-3.5 h-3.5" />} label="Load…" onClick={onLoad} />
          <button type="button" data-ourgeo-id="project.files" onClick={() => { setOpen(false); openProjectFiles() }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-foreground hover:bg-white/5"><FolderOpen className="w-3.5 h-3.5 text-geo-muted" />Project Files</button>

          {recentlyClosed.length > 0 && <>
            <div className="h-px bg-geo-border my-1" />
            <p className="px-3 py-1 text-[10px] uppercase tracking-wider text-geo-muted">Recently Closed Files</p>
            <div className="max-h-40 overflow-y-auto" data-ourgeo-id="project.recentlyClosed">
              {recentlyClosed.map((item) => (
                <button key={item.path} type="button" title={missing[item.path] ? `${item.path} — file not found` : item.path} disabled={missing[item.path]}
                  onClick={() => { setOpen(false); void openRecentlyClosed(item.path) }}
                  className={cn('w-full flex items-center gap-2 px-3 py-1 text-left text-xs', missing[item.path] ? 'text-geo-muted/60 cursor-not-allowed' : 'text-foreground hover:bg-white/5')}>
                  <FileClock className="w-3.5 h-3.5 text-geo-muted shrink-0" />
                  <span className="truncate flex-1">{item.path.split(/[\\/]/).pop()}</span>
                  {missing[item.path] && <span className="text-[10px] shrink-0">file not found</span>}
                </button>
              ))}
            </div>
          </>}
          <div className="h-px bg-geo-border my-1" />
          <p className="px-3 py-1 text-[10px] uppercase tracking-wider text-geo-muted">Recent Projects</p>
          {recents.length === 0 ? (
            <p className="px-3 py-1.5 text-xs text-geo-muted">No recent projects</p>
          ) : (
            recents.map((r) => (
              <button
                key={r.path}
                type="button"
                onClick={() => onRecent(r.path)}
                title={r.path}
                className="w-full flex flex-col items-start px-3 py-1.5 text-left hover:bg-white/5 transition-colors"
              >
                <span className="text-xs text-foreground truncate w-full">{r.name}</span>
                <span className="text-[10px] text-geo-muted truncate w-full">{r.path}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function MenuItem({
  icon, label, onClick, disabled, title,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  title?: string
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
        disabled
          ? 'text-geo-muted/50 cursor-not-allowed'
          : 'text-foreground hover:bg-white/5',
      )}
    >
      <span className="text-geo-muted">{icon}</span>
      {label}
    </button>
  )
}
