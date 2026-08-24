import React, { useEffect, useCallback } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderOpen, Database } from 'lucide-react'
import { useDatabaseStore, type FsEntry, type OpenDb } from '@/store/database'
import { FileExtIcon } from './file-icons'
import { ObjectIcon } from './object-icons'
import type { RgeoObjectInfo } from '@/lib/r-client'
import { cn } from '@/lib/utils'

export interface FsTreeHandlers {
  openDatabase: (filePath: string) => void | Promise<void>
  toggleDbExpanded: (filePath: string) => void
  onRgeoContextMenu: (e: React.MouseEvent, filePath: string) => void
  onObjectContextMenu: (e: React.MouseEvent, filePath: string, obj: RgeoObjectInfo) => void
  onDataFileContextMenu: (e: React.MouseEvent, filePath: string) => void
  filteredObjects: (objs: RgeoObjectInfo[]) => RgeoObjectInfo[]
  searchMatch: (name: string) => boolean
}

interface FsTreeNodeProps {
  entry: FsEntry
  depth: number
  handlers: FsTreeHandlers
}

function isRgeoFile(name: string): boolean {
  return name.toLowerCase().endsWith('.rgeo')
}

export function FsTreeNode({ entry, depth, handlers }: FsTreeNodeProps): React.ReactElement | null {
  if (entry.isDirectory) {
    return <FolderNode entry={entry} depth={depth} handlers={handlers} />
  }
  if (isRgeoFile(entry.name)) {
    return <RgeoFileNode entry={entry} depth={depth} handlers={handlers} />
  }
  if (!handlers.searchMatch(entry.name)) return null
  return <DataFileNode entry={entry} depth={depth} handlers={handlers} />
}

function FolderNode({ entry, depth, handlers }: FsTreeNodeProps): React.ReactElement {
  const expanded = useDatabaseStore((s) => !!s.expandedFolders[entry.path])
  const children = useDatabaseStore((s) => s.folderEntries[entry.path])
  const setFolderEntries = useDatabaseStore((s) => s.setFolderEntries)
  const toggleFolderExpanded = useDatabaseStore((s) => s.toggleFolderExpanded)

  // Lazy load children the first time the folder expands
  useEffect(() => {
    if (!expanded || children !== undefined) return
    let cancelled = false
    void (async () => {
      const entries = await window.electronAPI.fs.listDirectory(entry.path)
      if (!cancelled) setFolderEntries(entry.path, entries)
    })()
    return () => { cancelled = true }
  }, [expanded, children, entry.path, setFolderEntries])

  const toggle = useCallback(() => {
    toggleFolderExpanded(entry.path)
  }, [entry.path, toggleFolderExpanded])

  const visibleChildren = children?.filter((c) =>
    c.isDirectory || isRgeoFile(c.name) || handlers.searchMatch(c.name)
  ) ?? []

  return (
    <>
      <div
        className="flex items-center gap-1.5 py-0.5 cursor-pointer hover:bg-geo-bg/40 text-xs text-foreground"
        style={{ paddingLeft: 8 + depth * 12, paddingRight: 8 }}
        onDoubleClick={toggle}
      >
        <button
          className="flex-shrink-0 text-geo-muted hover:text-foreground"
          onClick={toggle}
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
        {expanded
          ? <FolderOpen className="w-3 h-3 flex-shrink-0 text-geo-accent" />
          : <Folder className="w-3 h-3 flex-shrink-0 text-geo-muted" />}
        <span className="truncate" title={entry.path}>{entry.name}</span>
      </div>
      {expanded && children === undefined && (
        <div
          className="text-[10px] text-geo-muted italic"
          style={{ paddingLeft: 8 + (depth + 1) * 12 + 16, paddingRight: 8, paddingTop: 2, paddingBottom: 2 }}
        >
          loading…
        </div>
      )}
      {expanded && visibleChildren.map((child) => (
        <FsTreeNode key={child.path} entry={child} depth={depth + 1} handlers={handlers} />
      ))}
    </>
  )
}

function RgeoFileNode({ entry, depth, handlers }: FsTreeNodeProps): React.ReactElement | null {
  const openDb: OpenDb | undefined = useDatabaseStore((s) => s.openDbs[entry.path])
  const isOpen = !!openDb
  const expanded = isOpen && (openDb?.expanded ?? false)

  const toggle = useCallback(() => {
    if (!isOpen) handlers.openDatabase(entry.path)
    else handlers.toggleDbExpanded(entry.path)
  }, [isOpen, entry.path, handlers])

  const visibleObjects = openDb ? handlers.filteredObjects(openDb.objects) : []
  const matchesSearch = handlers.searchMatch(entry.name)
  const hasVisibleObjects = visibleObjects.length > 0

  // Hide the row entirely if neither the file name nor any of its objects match search
  if (!matchesSearch && !hasVisibleObjects) return null

  return (
    <>
      <div
        className="flex items-center gap-1.5 py-0.5 cursor-pointer hover:bg-geo-bg/40 text-xs text-foreground"
        style={{ paddingLeft: 8 + depth * 12, paddingRight: 8 }}
        onDoubleClick={toggle}
        onContextMenu={(e) => handlers.onRgeoContextMenu(e, entry.path)}
      >
        <button
          className="flex-shrink-0 text-geo-muted hover:text-foreground"
          onClick={toggle}
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
        <Database className={cn('w-3 h-3 flex-shrink-0', isOpen ? 'text-geo-accent' : 'text-geo-muted')} />
        <span className="truncate" title={entry.path}>{entry.name}</span>
        {!isOpen && <span className="ml-auto text-[9px] text-geo-muted/70">closed</span>}
      </div>
      {expanded && openDb && visibleObjects.length === 0 && (
        <div
          className="text-[10px] text-geo-muted italic"
          style={{ paddingLeft: 8 + (depth + 1) * 12 + 16, paddingRight: 8, paddingTop: 2, paddingBottom: 2 }}
        >
          (empty)
        </div>
      )}
      {expanded && openDb && visibleObjects.map((obj) => (
        <div
          key={obj.name}
          className="flex items-center gap-1.5 py-0.5 cursor-default hover:bg-geo-bg/40 text-xs text-foreground"
          style={{ paddingLeft: 8 + (depth + 1) * 12 + 12, paddingRight: 8 }}
          onContextMenu={(e) => handlers.onObjectContextMenu(e, entry.path, obj)}
          title={
            obj.kind +
            (obj.geometry_type ? ` · ${obj.geometry_type}` : '') +
            (obj.crs ? ` · ${obj.crs}` : '') +
            (obj.n_rows ? ` · ${obj.n_rows} rows` : '')
          }
        >
          <ObjectIcon kind={obj.kind} geometryType={obj.geometry_type} rClass={obj.r_class} size={13} />
          <span className="truncate">{obj.name}</span>
          <span className="ml-auto text-[9px] text-geo-muted/70 flex-shrink-0">{obj.kind}</span>
        </div>
      ))}
    </>
  )
}

function DataFileNode({ entry, depth, handlers }: FsTreeNodeProps): React.ReactElement {
  return (
    <div
      className="flex items-center gap-1.5 py-0.5 cursor-default hover:bg-geo-bg/40 text-xs text-foreground"
      style={{ paddingLeft: 8 + depth * 12 + 16, paddingRight: 8 }}
      onContextMenu={(e) => handlers.onDataFileContextMenu(e, entry.path)}
    >
      <FileExtIcon name={entry.name} />
      <span className="truncate" title={entry.path}>{entry.name}</span>
    </div>
  )
}
