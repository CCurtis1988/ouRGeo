import React, { useCallback, useEffect, useState } from 'react'
import {
  RefreshCw, Search, X, Loader2, Plus, FolderTree, Clock,
  ChevronDown, ChevronRight, Database, FolderOpen
} from 'lucide-react'
import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'
import { ContextMenu, type ContextMenuItem } from '../ui/context-menu'
import { useDatabaseStore, type OpenDb } from '@/store/database'
import { useEnvironmentStore } from '@/store/environment'
import { useSessionStore } from '@/store/session'
import { rClient, type RgeoObjectInfo } from '@/lib/r-client'
import { saveDatabasePrefs, loadDatabasePrefs } from '@/lib/database-persistence'
import { CreateDatabaseDialog } from './CreateDatabaseDialog'
import { ObjectIcon } from './object-icons'
import { FsTreeNode, type FsTreeHandlers } from './FsTreeNode'
import { cn } from '@/lib/utils'

// Extensions LoadDataDialog can handle — mirrors `dialog:openDataFile` filter in electron/main/ipc.ts
const LOAD_DATA_EXTS = new Set([
  'csv','tsv','tab','txt','xlsx','xls','ods','json','geojson',
  'parquet','feather','sas7bdat','sav','dta',
  'shp','gpkg','kml','kmz','gml','dxf','gpx','fgb',
])

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

function relpath(file: string, folder: string | null): string {
  if (!folder) return file
  return file.startsWith(folder) ? file.slice(folder.length).replace(/^[\\/]/, '') : file
}

function logToConsole(text: string): void {
  useSessionStore.getState().addConsoleEntry('input', text)
}

export function DatabasePanel(): React.ReactElement {
  const {
    isOpen: _isOpen, searchQuery, isLoading, error,
    workspaceFolder, workspaceExpanded,
    recents, recentsExpanded, openDbs,
    folderEntries,
  } = useDatabaseStore()
  const setSearchQuery = useDatabaseStore((s) => s.setSearchQuery)
  const setLoading = useDatabaseStore((s) => s.setLoading)
  const setError = useDatabaseStore((s) => s.setError)
  const toggleOpen = useDatabaseStore((s) => s.toggleOpen)
  const setWorkspaceFolder = useDatabaseStore((s) => s.setWorkspaceFolder)
  const setFolderEntries = useDatabaseStore((s) => s.setFolderEntries)
  const clearFolderTree = useDatabaseStore((s) => s.clearFolderTree)
  const setRequestedLoadFile = useDatabaseStore((s) => s.setRequestedLoadFile)
  const toggleWorkspaceExpanded = useDatabaseStore((s) => s.toggleWorkspaceExpanded)
  const setRecents = useDatabaseStore((s) => s.setRecents)
  const toggleRecentsExpanded = useDatabaseStore((s) => s.toggleRecentsExpanded)
  const setOpenDb = useDatabaseStore((s) => s.setOpenDb)
  const removeOpenDb = useDatabaseStore((s) => s.removeOpenDb)
  const setObjects = useDatabaseStore((s) => s.setObjects)
  const toggleDbExpanded = useDatabaseStore((s) => s.toggleDbExpanded)

  const [showCreate, setShowCreate] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)
  const [connectPrompt, setConnectPrompt] = useState<{ filePath: string; name: string; defaultVar: string; mode: 'connect' | 'load' } | null>(null)
  const [connectVar, setConnectVar] = useState('')

  // Initial mount: load prefs + recents + workspace scan
  useEffect(() => {
    let cancelled = false
    async function init(): Promise<void> {
      await loadDatabasePrefs()
      const folder = useDatabaseStore.getState().workspaceFolder
      if (!cancelled) await refreshRecents()
      if (folder && !cancelled) await refreshWorkspace(folder)
    }
    init()
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const refreshRecents = useCallback(async () => {
    try {
      const res = await rClient.dbRecents()
      if (res.success && res.files) setRecents(res.files)
    } catch {
      // ignore
    }
  }, [setRecents])

  const refreshWorkspace = useCallback(async (folder: string) => {
    try {
      const entries = await window.electronAPI.fs.listDirectory(folder)
      setFolderEntries(folder, entries)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to scan workspace')
    }
  }, [setFolderEntries, setError])

  const handlePickWorkspace = async (): Promise<void> => {
    const folder = await window.electronAPI.dialog.openWorkspaceFolder()
    if (!folder) return
    clearFolderTree()
    setWorkspaceFolder(folder)
    saveDatabasePrefs()
    await refreshWorkspace(folder)
  }

  const handleRefresh = async (): Promise<void> => {
    setLoading(true)
    try {
      await refreshRecents()
      if (workspaceFolder) await refreshWorkspace(workspaceFolder)
      // Refresh objects on each open db
      for (const fp of Object.keys(openDbs)) {
        const db = openDbs[fp]
        const res = await rClient.dbListObjects(db.handle)
        if (res.success && res.objects) setObjects(fp, res.objects)
      }
    } finally {
      setLoading(false)
    }
  }

  const openDatabase = useCallback(async (filePath: string): Promise<OpenDb | null> => {
    if (openDbs[filePath]) return openDbs[filePath]
    setLoading(true)
    setError(null)
    try {
      const res = await rClient.dbOpen(filePath)
      if (!res.success || !res.handle) {
        setError(res.error ?? 'Failed to open database')
        return null
      }
      logToConsole(`# Opened .Rgeo: ${filePath}`)
      const db: OpenDb = { filePath, handle: res.handle, objects: res.objects ?? [], expanded: true }
      setOpenDb(db)
      await rClient.dbRecentsAdd(filePath)
      await refreshRecents()
      return db
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Open failed')
      return null
    } finally {
      setLoading(false)
    }
  }, [openDbs, setOpenDb, setLoading, setError, refreshRecents])

  const closeDatabase = async (filePath: string): Promise<void> => {
    const db = openDbs[filePath]
    if (!db) return
    try {
      await rClient.dbClose(db.handle)
    } catch {
      // ignore
    }
    removeOpenDb(filePath)
  }

  const handleOpenFromDialog = async (): Promise<void> => {
    const filePath = await window.electronAPI.dialog.openRgeo()
    if (!filePath) return
    await openDatabase(filePath)
  }

  const handleCreated = async (filePath: string): Promise<void> => {
    setShowCreate(false)
    await refreshRecents()
    if (workspaceFolder) await refreshWorkspace(workspaceFolder)
    await openDatabase(filePath)
  }

  const handleDeleteObject = async (filePath: string, name: string): Promise<void> => {
    if (!confirm(`Delete "${name}" from this database?`)) return
    const db = openDbs[filePath]
    if (!db) return
    const res = await rClient.dbDeleteObject(db.handle, name)
    if (!res.success) {
      setError(res.error ?? 'Delete failed')
      return
    }
    logToConsole(`# Deleted "${name}" from ${basename(filePath)}`)
    const list = await rClient.dbListObjects(db.handle)
    if (list.success && list.objects) setObjects(filePath, list.objects)
  }

  const handleConnectObject = async (): Promise<void> => {
    if (!connectPrompt) return
    const varName = connectVar.trim() || connectPrompt.defaultVar
    if (!/^[A-Za-z._][A-Za-z0-9._]*$/.test(varName)) {
      setError('Invalid R variable name')
      return
    }
    const db = openDbs[connectPrompt.filePath]
    if (!db) return
    const res = await rClient.dbConnectObject(db.handle, connectPrompt.name, varName, connectPrompt.mode)
    if (!res.success) {
      setError(res.error ?? 'Connect failed')
      return
    }
    logToConsole(`# From ${basename(connectPrompt.filePath)}`)
    if (res.code) logToConsole(res.code)
    setConnectPrompt(null)
    setConnectVar('')
    // Trigger environment refresh so new variable shows up
    try {
      const env = await rClient.listEnvironments()
      if (env.success) useEnvironmentStore.getState().setEnvironments(env.environments)
    } catch { /* ignore */ }
  }

  const objectContextItems = (filePath: string, obj: RgeoObjectInfo): ContextMenuItem[] => {
    // Rasters connect as a live link too (format v3): the env var is a
    // file-backed SpatRaster streamed from the tile pyramid, with a proxy so
    // project save/reconnect rebuilds it.
    const queryable =
      obj.kind === 'data.frame' || obj.kind === 'tibble' || obj.kind === 'data.table' ||
      obj.kind === 'sf' || obj.kind === 'geos' || obj.kind === 'raster'
    return [
      {
        label: 'Connect to dataset…',
        disabled: !queryable,
        onClick: () => {
          setConnectPrompt({ filePath, name: obj.name, defaultVar: obj.name, mode: 'connect' })
          setConnectVar(obj.name)
        }
      },
      {
        label: 'Load to environment…',
        onClick: () => {
          setConnectPrompt({ filePath, name: obj.name, defaultVar: obj.name, mode: 'load' })
          setConnectVar(obj.name)
        }
      },
      { label: 'Preview…', onClick: () => previewObject(filePath, obj) },
      { separator: true, label: '' },
      { label: 'Delete object', onClick: () => handleDeleteObject(filePath, obj.name) }
    ]
  }

  const fileContextItems = (filePath: string, isOpenAlready: boolean, isRecent: boolean): ContextMenuItem[] => {
    const items: ContextMenuItem[] = isOpenAlready
      ? [{ label: 'Close', onClick: () => closeDatabase(filePath) }]
      : [{ label: 'Open', onClick: () => openDatabase(filePath) }]
    items.push({
      label: 'Reveal in Files',
      onClick: () => window.electronAPI.shell.showItemInFolder(filePath)
    })
    if (isRecent) {
      items.push({ separator: true, label: '' })
      items.push({
        label: 'Remove from recents',
        onClick: async () => {
          // server has no remove endpoint; rewrite by adding others back. Simplest: just set local state.
          setRecents(recents.filter(r => r !== filePath))
        }
      })
    }
    return items
  }

  const dataFileContextItems = (filePath: string): ContextMenuItem[] => {
    const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
    const items: ContextMenuItem[] = []
    if (LOAD_DATA_EXTS.has(ext)) {
      items.push({ label: 'Load file…', onClick: () => setRequestedLoadFile(filePath) })
      items.push({ separator: true, label: '' })
    }
    items.push({
      label: 'Reveal in Files',
      onClick: () => window.electronAPI.shell.showItemInFolder(filePath)
    })
    return items
  }

  const previewObject = async (filePath: string, obj: RgeoObjectInfo): Promise<void> => {
    const db = openDbs[filePath]
    if (!db) return
    const res = await rClient.dbPreviewObject(db.handle, obj.name, 50)
    if (!res.success) {
      logToConsole(`# Preview failed: ${res.error}`)
      return
    }
    if (res.message) {
      logToConsole(`# ${res.message}`)
    } else if (res.rows) {
      logToConsole(`# Preview of ${obj.name}: ${res.rows.length} rows × ${res.columns?.length ?? 0} cols`)
    }
  }

  const filteredFiles = (files: string[]): string[] => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return files
    return files.filter(f => basename(f).toLowerCase().includes(q))
  }

  const filteredObjects = (objects: RgeoObjectInfo[]): RgeoObjectInfo[] => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return objects
    return objects.filter(o => o.name.toLowerCase().includes(q))
  }

  const searchMatch = useCallback((name: string): boolean => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return true
    return name.toLowerCase().includes(q)
  }, [searchQuery])

  const treeHandlers: FsTreeHandlers = {
    openDatabase: (fp: string) => { void openDatabase(fp) },
    toggleDbExpanded,
    onRgeoContextMenu: (e, fp) => {
      e.preventDefault()
      setContextMenu({ x: e.clientX, y: e.clientY, items: fileContextItems(fp, !!openDbs[fp], false) })
    },
    onObjectContextMenu: (e, fp, obj) => {
      e.preventDefault()
      setContextMenu({ x: e.clientX, y: e.clientY, items: objectContextItems(fp, obj) })
    },
    onDataFileContextMenu: (e, fp) => {
      e.preventDefault()
      setContextMenu({ x: e.clientX, y: e.clientY, items: dataFileContextItems(fp) })
    },
    filteredObjects,
    searchMatch,
  }

  return (
    <div className="flex-1 min-h-0 bg-geo-panel flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-9 border-b border-geo-border flex-shrink-0">
        <span className="text-xs font-semibold text-foreground">Databases</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-geo-muted hover:text-foreground"
            onClick={handleRefresh}
            title="Refresh"
          >
            <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-geo-muted hover:text-foreground"
            onClick={() => setShowCreate(true)}
            title="Create database"
          >
            <Plus className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-geo-muted hover:text-foreground"
            onClick={handleOpenFromDialog}
            title="Open .Rgeo file"
          >
            <FolderOpen className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-geo-muted hover:text-foreground"
            onClick={toggleOpen}
            title="Close panel"
          >
            <X className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-1.5 border-b border-geo-border flex-shrink-0">
        <div className="flex items-center gap-1.5 bg-geo-bg rounded px-2 py-1">
          <Search className="w-3 h-3 text-geo-muted flex-shrink-0" />
          <input
            type="text"
            placeholder="Search databases & objects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent text-xs text-foreground placeholder:text-geo-muted outline-none w-full"
          />
        </div>
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-1 px-3 py-1 border-b border-geo-border flex-shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-1.5 text-[10px] text-geo-muted hover:text-foreground gap-1"
          onClick={() => setShowCreate(true)}
        >
          <Plus className="w-3 h-3" /> Create
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-1.5 text-[10px] text-geo-muted hover:text-foreground gap-1"
          onClick={handlePickWorkspace}
          title="Choose workspace folder"
        >
          <FolderTree className="w-3 h-3" /> Workspace
        </Button>
      </div>

      {error && (
        <div className="px-3 py-1.5 border-b border-geo-border flex items-center gap-2 flex-shrink-0">
          <span className="text-[11px] text-geo-error flex-1 truncate">{error}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-geo-muted hover:text-foreground"
            onClick={() => setError(null)}
          >
            <X className="w-3 h-3" />
          </Button>
        </div>
      )}

      {/* Content */}
      <ScrollArea className="flex-1">
        {/* Recents group */}
        <div className="border-b border-geo-border/50">
          <button
            className="w-full flex items-center gap-1.5 px-2 py-1 text-xs text-geo-muted hover:text-foreground"
            onClick={toggleRecentsExpanded}
          >
            {recentsExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            <Clock className="w-3 h-3" />
            <span className="font-semibold">Recent</span>
            <span className="ml-auto text-[10px]">{recents.length}</span>
          </button>
          {recentsExpanded && filteredFiles(recents).map((fp) => (
            <FileRow
              key={fp}
              filePath={fp}
              displayName={basename(fp)}
              subtitle={fp}
              isOpen={!!openDbs[fp]}
              openDb={openDbs[fp]}
              depth={1}
              onDoubleClick={() => {
                if (!openDbs[fp]) openDatabase(fp)
                else toggleDbExpanded(fp)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setContextMenu({ x: e.clientX, y: e.clientY, items: fileContextItems(fp, !!openDbs[fp], true) })
              }}
              onObjectContextMenu={(e, obj) => {
                e.preventDefault()
                setContextMenu({ x: e.clientX, y: e.clientY, items: objectContextItems(fp, obj) })
              }}
              onToggleExpand={() => {
                if (!openDbs[fp]) openDatabase(fp)
                else toggleDbExpanded(fp)
              }}
              filteredObjects={filteredObjects}
            />
          ))}
        </div>

        {/* Workspace group */}
        <div>
          <button
            className="w-full flex items-center gap-1.5 px-2 py-1 text-xs text-geo-muted hover:text-foreground"
            onClick={toggleWorkspaceExpanded}
          >
            {workspaceExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            <FolderTree className="w-3 h-3" />
            <span className="font-semibold">Workspace</span>
            {workspaceFolder && (
              <span className="ml-1 text-[10px] truncate text-geo-muted/70">
                {basename(workspaceFolder)}
              </span>
            )}
            <span className="ml-auto text-[10px]">
              {workspaceFolder ? folderEntries[workspaceFolder]?.length ?? 0 : 0}
            </span>
          </button>
          {workspaceExpanded && !workspaceFolder && (
            <div className="px-3 py-2 text-[11px] text-geo-muted">
              Pick a workspace folder to browse its files.
              <Button
                variant="ghost"
                size="sm"
                className="ml-2 h-5 px-1.5 text-[10px] text-geo-accent"
                onClick={handlePickWorkspace}
              >
                Choose…
              </Button>
            </div>
          )}
          {workspaceExpanded && workspaceFolder && (folderEntries[workspaceFolder] ?? []).map((entry) => (
            <FsTreeNode
              key={entry.path}
              entry={entry}
              depth={1}
              handlers={treeHandlers}
            />
          ))}
        </div>
      </ScrollArea>

      {/* Status footer */}
      <div className="px-3 h-6 border-t border-geo-border flex items-center text-[10px] text-geo-muted flex-shrink-0">
        {Object.keys(openDbs).length} open · {Object.values(openDbs).reduce((s, db) => s + db.objects.length, 0)} objects
        {isLoading && <Loader2 className="w-3 h-3 animate-spin ml-2" />}
      </div>

      {/* Dialogs / overlays */}
      {showCreate && (
        <CreateDatabaseDialog onCreated={handleCreated} onCancel={() => setShowCreate(false)} />
      )}

      {connectPrompt && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
          onClick={() => setConnectPrompt(null)}
        >
          <div
            className="bg-geo-panel border border-geo-border rounded p-4 min-w-[320px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-geo-accent" />
              {connectPrompt.mode === 'connect' ? 'Connect to dataset' : 'Load to environment'}: "{connectPrompt.name}"
            </div>
            <label className="text-[10px] text-geo-muted">R variable name</label>
            <input
              autoFocus
              value={connectVar}
              onChange={(e) => setConnectVar(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConnectObject()
                if (e.key === 'Escape') setConnectPrompt(null)
              }}
              className="w-full mt-1 bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-geo-accent"
            />
            <div className="flex justify-end gap-2 mt-3">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs text-geo-muted"
                onClick={() => setConnectPrompt(null)}
              >
                Cancel
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs text-geo-accent"
                onClick={handleConnectObject}
              >
                {connectPrompt.mode === 'connect' ? 'Connect' : 'Load'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}

interface FileRowProps {
  filePath: string
  displayName: string
  subtitle: string
  isOpen: boolean
  openDb: OpenDb | undefined
  depth: number
  onDoubleClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onObjectContextMenu: (e: React.MouseEvent, obj: RgeoObjectInfo) => void
  onToggleExpand: () => void
  filteredObjects: (objs: RgeoObjectInfo[]) => RgeoObjectInfo[]
}

function FileRow({
  filePath: _filePath, displayName, subtitle, isOpen, openDb, depth,
  onDoubleClick, onContextMenu, onObjectContextMenu, onToggleExpand, filteredObjects
}: FileRowProps): React.ReactElement {
  const expanded = isOpen && (openDb?.expanded ?? false)
  return (
    <>
      <div
        className={cn(
          'flex items-center gap-1.5 py-0.5 cursor-pointer hover:bg-geo-bg/40',
          'text-xs text-foreground'
        )}
        style={{ paddingLeft: 8 + depth * 12, paddingRight: 8 }}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
      >
        <button
          className="flex-shrink-0 text-geo-muted hover:text-foreground"
          onClick={onToggleExpand}
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
        <Database className={cn('w-3 h-3 flex-shrink-0', isOpen ? 'text-geo-accent' : 'text-geo-muted')} />
        <span className="truncate" title={subtitle}>{displayName}</span>
        {!isOpen && <span className="ml-auto text-[9px] text-geo-muted/70">closed</span>}
      </div>
      {expanded && openDb && filteredObjects(openDb.objects).length === 0 && (
        <div
          className="text-[10px] text-geo-muted italic"
          style={{ paddingLeft: 8 + (depth + 1) * 12 + 16, paddingRight: 8, paddingTop: 2, paddingBottom: 2 }}
        >
          (empty)
        </div>
      )}
      {expanded && openDb && filteredObjects(openDb.objects).map((obj) => (
        <div
          key={obj.name}
          className="flex items-center gap-1.5 py-0.5 cursor-default hover:bg-geo-bg/40 text-xs text-foreground"
          style={{ paddingLeft: 8 + (depth + 1) * 12 + 12, paddingRight: 8 }}
          onContextMenu={(e) => onObjectContextMenu(e, obj)}
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
