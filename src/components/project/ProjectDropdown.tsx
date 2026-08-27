import React, { useState, useRef, useEffect } from 'react'
import { ChevronDown, Save, SaveAll, FilePlus, FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSessionStore } from '@/store/session'
import { useProjectStore } from '@/store/project'
import {
  saveCurrentProject,
  saveProjectAs,
  loadProject,
  loadProjectFromPath,
  newProject,
} from '@/lib/project-persistence'
import { confirmUnsaved } from './UnsavedChangesDialog'

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
  const recents = useProjectStore((s) => s.recents)
  const isScratch = path === null

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Prompt to save if dirty; returns false if the user cancels (abort switch).
  async function guardSwitch(): Promise<boolean> {
    const choice = await confirmUnsaved()
    if (choice === 'cancel') return false
    if (choice === 'save') {
      const saved = await saveCurrentProject()
      if (!saved) return false // Save As dialog cancelled
    }
    return true
  }

  function run(action: () => Promise<unknown>): void {
    setOpen(false)
    setBusy(true)
    void action().finally(() => setBusy(false))
  }

  const onSave = (): void => run(saveCurrentProject)
  const onSaveAs = (): void => run(saveProjectAs)
  const onNew = (): void => run(async () => { if (await guardSwitch()) await newProject() })
  const onLoad = (): void => run(async () => { if (await guardSwitch()) await loadProject() })
  const onRecent = (path: string): void =>
    run(async () => { if (await guardSwitch()) await loadProjectFromPath(path) })

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        title={STATUS_LABEL[rStatus] ?? rStatus}
        data-ourgeo-id="project.dropdown"
        className={cn(
          'flex items-center gap-1.5 h-6 px-2 rounded text-xs transition-colors',
          'text-geo-muted hover:text-foreground hover:bg-white/5',
          open && 'bg-white/5 text-foreground',
          busy && 'opacity-60 cursor-wait',
        )}
      >
        <span className={cn('w-2 h-2 rounded-full flex-shrink-0', STATUS_COLOR[rStatus] ?? 'bg-geo-muted')} />
        <span className="max-w-[10rem] truncate text-foreground">{name}</span>
        {isDirty && !isScratch && <span className="text-geo-muted" title="Unsaved changes">•</span>}
        <ChevronDown className="w-3 h-3 flex-shrink-0" />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 z-50 w-56 bg-geo-panel border border-geo-border rounded-lg shadow-xl overflow-hidden">
          <MenuItem
            icon={<Save className="w-3.5 h-3.5" />}
            label="Save"
            onClick={onSave}
            disabled={isScratch}
            title={isScratch ? 'The scratch project can’t be saved — use Save As' : undefined}
          />
          <MenuItem icon={<SaveAll className="w-3.5 h-3.5" />} label="Save As…" onClick={onSaveAs} />
          <MenuItem icon={<FilePlus className="w-3.5 h-3.5" />} label="New" onClick={onNew} />
          <MenuItem icon={<FolderOpen className="w-3.5 h-3.5" />} label="Load…" onClick={onLoad} />

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
