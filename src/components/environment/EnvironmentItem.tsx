import React, { useState, useRef, useEffect } from 'react'
import { ChevronRight, ChevronDown, Database, Link2 } from 'lucide-react'
import type { RObjectInfo, REnvironmentInfo } from '@/lib/r-client'
import { ContextMenu, type ContextMenuItem } from '../ui/context-menu'
import { useSessionStore } from '@/store/session'
import { useEditorStore } from '@/store/editor'
import { useDatabaseStore, type OpenDb } from '@/store/database'
import { useSpatialStore } from '@/store/spatial'
import { useGeometryEditStore } from '@/store/geometryEdit'
import { rClient } from '@/lib/r-client'
import { SaveConflictDialog, type SaveConflictDecision } from '../database/SaveConflictDialog'
import {
  VIEWABLE_DATA_CLASSES,
  VIEWABLE_VECTOR_CLASSES,
  VIEWABLE_MATRIX_CLASS,
  SF_CLASSES,
  isViewable,
  isTabularExportable,
  isVectorExportable,
  inferGeometryType,
} from '@/lib/validators'

function basenameRgeo(p: string): string {
  const leaf = p.split(/[\\/]/).pop() ?? p
  return leaf.replace(/\.Rgeo$/i, '')
}

function formatSize(bytes: number): string {
  if (bytes === 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Recursively collect all environment names from the environment list, including nested env objects */
function collectAllEnvNames(
  environments: REnvironmentInfo[],
  currentEnvName: string
): string[] {
  const names: string[] = []

  function walkObjects(objects: RObjectInfo[], parentEnvName: string) {
    for (const obj of objects) {
      if (obj.isEnvironment) {
        names.push(obj.name)
        if (obj.children) {
          walkObjects(obj.children, obj.name)
        }
      }
    }
  }

  for (const env of environments) {
    if (env.name !== currentEnvName) {
      names.push(env.name)
    }
    // Walk into objects to find nested environments
    walkObjects(env.objects, env.name)
  }

  // Deduplicate and remove current env
  return [...new Set(names)].filter((n) => n !== currentEnvName)
}

interface EnvironmentItemProps {
  obj: RObjectInfo
  envName: string
  allEnvironments: REnvironmentInfo[]
  onRefresh: () => void
  depth?: number
  accessPath?: string
}

function buildExportCode(
  accessPath: string,
  objName: string,
  cls: string,
  format: 'csv' | 'txt' | 'xlsx' | 'r',
  filePath: string
): string {
  const p = filePath.replace(/\\/g, '/')

  if (format === 'r') {
    return `writeLines(c(paste0("${objName} <- ", paste(deparse(${accessPath}), collapse = "\n")), ""), con = "${p}")`
  }

  const expr = isVectorExportable(cls)
    ? `data.frame(${objName} = ${accessPath})`
    : cls === VIEWABLE_MATRIX_CLASS
      ? `as.data.frame(${accessPath})`
      : accessPath

  switch (format) {
    case 'csv':
      return `write.csv(${expr}, "${p}", row.names = FALSE)`
    case 'txt':
      return `write.table(${expr}, "${p}", sep = "\\t", row.names = FALSE, quote = FALSE)`
    case 'xlsx':
      return `writexl::write_xlsx(${expr}, "${p}")`
  }
}

export function EnvironmentItem({
  obj,
  envName,
  allEnvironments,
  onRefresh,
  depth = 0,
  accessPath: accessPathProp
}: EnvironmentItemProps): React.ReactElement {
  const currentAccessPath = accessPathProp || obj.name
  const [expanded, setExpanded] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(obj.name)
  const [copying, setCopying] = useState(false)
  const [copyName, setCopyName] = useState(obj.name + '_copy')
  const [dbList, setDbList] = useState<{ filePath: string; isOpen: boolean }[]>([])
  const [conflictPrompt, setConflictPrompt] = useState<{
    db: OpenDb
    filePath: string
    existingNames: string[]
    resolve: (d: SaveConflictDecision) => void
  } | null>(null)
  const workspaceFolder = useDatabaseStore((s) => s.workspaceFolder)
  const renameRef = useRef<HTMLInputElement>(null)
  const copyRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renaming && renameRef.current) renameRef.current.focus()
  }, [renaming])

  useEffect(() => {
    if (copying && copyRef.current) copyRef.current.focus()
  }, [copying])

  useEffect(() => {
    if (!contextMenu || !workspaceFolder || !window.electronAPI) {
      if (!contextMenu) setDbList([])
      return
    }
    let cancelled = false
    void (async () => {
      const paths = await window.electronAPI!.fs.scanRgeo(workspaceFolder)
      if (cancelled) return
      const opens = useDatabaseStore.getState().openDbs
      setDbList(paths.map((p) => ({ filePath: p, isOpen: !!opens[p] })))
    })()
    return () => { cancelled = true }
  }, [contextMenu, workspaceFolder])

  const logToConsole = (cmd: string) => {
    useSessionStore.getState().addConsoleEntry('input', cmd)
  }

  const handleRemove = async () => {
    logToConsole(`rm("${obj.name}", envir = ${envName})`)
    await rClient.envRemove(obj.name, envName)
    onRefresh()
  }

  const handleRename = async () => {
    const newName = renameValue.trim()
    if (!newName || newName === obj.name) {
      setRenaming(false)
      return
    }
    logToConsole(
      `assign("${newName}", get("${obj.name}", envir = ${envName}), envir = ${envName}); rm("${obj.name}", envir = ${envName})`
    )
    await rClient.envRename(obj.name, newName, envName)
    setRenaming(false)
    onRefresh()
  }

  const handleCopy = async (toEnv?: string) => {
    const name = copyName.trim() || obj.name + '_copy'
    const targetEnv = toEnv || envName
    logToConsole(`assign("${name}", get("${obj.name}", envir = ${envName}), envir = ${targetEnv})`)
    await rClient.envCopy(obj.name, envName, targetEnv, name)
    setCopying(false)
    onRefresh()
  }

  const handleMove = async (toEnv: string) => {
    logToConsole(
      `assign("${obj.name}", get("${obj.name}", envir = ${envName}), envir = ${toEnv}); rm("${obj.name}", envir = ${envName})`
    )
    await rClient.envMove(obj.name, envName, toEnv)
    onRefresh()
  }

  const handleSaveToDb = async (filePath: string) => {
    const dbStore = useDatabaseStore.getState()
    let db: OpenDb | undefined = dbStore.openDbs[filePath]
    if (!db) {
      const res = await rClient.dbOpen(filePath)
      if (!res.success || !res.handle) {
        useSessionStore.getState().addConsoleEntry('error', res.error ?? 'Failed to open database')
        return
      }
      db = { filePath, handle: res.handle, objects: res.objects ?? [], expanded: true }
      dbStore.setOpenDb(db)
      void rClient.dbRecentsAdd(filePath)
    }

    let targetName = obj.name
    const existingNames = db.objects.map((o) => o.name)
    if (existingNames.includes(targetName)) {
      const decision = await new Promise<SaveConflictDecision>((resolve) => {
        setConflictPrompt({ db: db!, filePath, existingNames, resolve })
      })
      setConflictPrompt(null)
      if (decision.action === 'cancel') return
      if (decision.action === 'rename') targetName = decision.newName
    }

    logToConsole(`# Save '${currentAccessPath}' to ${basenameRgeo(filePath)}.Rgeo as '${targetName}'`)
    const imp = await rClient.dbImportObject(db.handle, currentAccessPath, targetName)
    if (!imp.success) {
      useSessionStore.getState().addConsoleEntry('error', imp.error ?? 'Failed to save to database')
      return
    }

    const list = await rClient.dbListObjects(db.handle)
    if (list.success && list.objects) {
      dbStore.setObjects(filePath, list.objects)
    }
  }

  const handleSendToSpatial = async () => {
    const proxy = obj.rgeoProxy
    if (!proxy) return
    const spatial = useSpatialStore.getState()
    const editStore = useGeometryEditStore.getState()

    const newLayerId = spatial.addLayer({
      name: obj.name,
      envName: '',
      geometryType: proxy.geometryType ?? 'GEOMETRY',
      geojson: { type: 'FeatureCollection', features: [] },
      colLib: 'sf',
      columnName: proxy.geometryColumn ?? 'geometry',
      tileSource: {
        handle: proxy.handle,
        name: proxy.name,
        geometryColumn: proxy.geometryColumn ?? 'geometry',
        pkColumn: proxy.pkColumn ?? 'rowid',
        crs: proxy.crs ?? null
      }
    })

    if (!editStore.activeSessionId) editStore.createNamedSession('Default')
    editStore.addLayerToActiveSession(newLayerId)

    spatial.ensureOpen()

    // Db-backed layers start with empty geojson, so requestFitBounds alone
    // would have nothing to fit. Resolve the dataset's full bbox first so
    // the editor lands on the data; tiles populate from there.
    const bboxRes = await rClient.datasetBbox({ handle: proxy.handle, name: proxy.name })
    if (bboxRes.success && bboxRes.bbox) {
      spatial.setLayerFullBbox(newLayerId, bboxRes.bbox)
    }
    spatial.requestFitBounds()
  }

  const handleSendSfToSpatial = async () => {
    const spatial = useSpatialStore.getState()
    const editStore = useGeometryEditStore.getState()

    const res = await rClient.getSpatialGeoJSON(obj.name, envName)
    if (!res.success || !res.geojson) {
      useSessionStore
        .getState()
        .addConsoleEntry('error', res.error ?? `Failed to load GeoJSON for ${obj.name}`)
      return
    }

    const geojson =
      typeof res.geojson === 'string' ? JSON.parse(res.geojson) : res.geojson

    const newLayerId = spatial.addLayer({
      name: obj.name,
      envName,
      geometryType: inferGeometryType(geojson),
      geojson,
      colLib: obj.class === 'sf' || obj.class === 'sfc' ? 'sf' : 'geos',
      columnName: 'geometry'
    })

    if (!editStore.activeSessionId) editStore.createNamedSession('Default')
    editStore.addLayerToActiveSession(newLayerId)

    spatial.ensureOpen()
    spatial.requestFitBounds()
  }

  const handleExport = async (format: 'csv' | 'txt' | 'xlsx' | 'r') => {
    if (!window.electronAPI) return
    const filePath = await window.electronAPI.dialog.saveExportFile(format)
    if (!filePath) return
    const code = buildExportCode(currentAccessPath, obj.name, obj.class, format, filePath)
    logToConsole(code)
    const res = await rClient.execute(code)
    if (!res.success && res.error) {
      useSessionStore.getState().addConsoleEntry('error', res.error)
    }
  }

  const moveTargets = collectAllEnvNames(allEnvironments, envName)
  const moveSubmenu: ContextMenuItem[] = moveTargets.map((name) => ({
    label: name,
    onClick: () => handleMove(name)
  }))

  const dbSubmenu: ContextMenuItem[] = !workspaceFolder
    ? [{ label: 'Set workspace folder first', disabled: true }]
    : dbList.length === 0
      ? [{ label: 'No .Rgeo files in workspace', disabled: true }]
      : dbList.map(({ filePath, isOpen }) => ({
          label: `${isOpen ? '• ' : '  '}${basenameRgeo(filePath)}`,
          onClick: () => handleSaveToDb(filePath)
        }))

  const handleViewEdit = async () => {
    const cls = obj.class
    const store = useEditorStore.getState()

    if (cls === 'function') {
      try {
        const res = await rClient.getObjectFunction(obj.name, envName, currentAccessPath)
        if (res.success) {
          const code = `${currentAccessPath} <- ${res.source}`
          const tabId = store.addObjectTab(obj.name, envName, cls, currentAccessPath, 'function-editor')
          store.updateTabContent(tabId, code)
          // Mark as saved so it starts clean
          const tab = store.tabs.find((t) => t.id === tabId)
          if (tab) {
            useEditorStore.setState((s) => ({
              tabs: s.tabs.map((t) =>
                t.id === tabId ? { ...t, savedContent: code, isDirty: false } : t
              )
            }))
          }
        }
      } catch (err) {
        useSessionStore.getState().addConsoleEntry('error', `Failed to fetch function: ${err}`)
      }
    } else if (
      VIEWABLE_DATA_CLASSES.includes(cls) ||
      cls === VIEWABLE_MATRIX_CLASS ||
      VIEWABLE_VECTOR_CLASSES.includes(cls)
    ) {
      store.addObjectTab(obj.name, envName, cls, currentAccessPath, 'data-viewer')
    } else if (SF_CLASSES.includes(cls)) {
      store.addObjectTab(obj.name, envName, cls, currentAccessPath, 'data-viewer')
    }
  }

  const isSpatialProxy =
    !!obj.rgeoProxy && (obj.rgeoProxy.kind === 'sf' || obj.rgeoProxy.kind === 'geos')
  const isInMemorySf = SF_CLASSES.includes(obj.class) && !obj.rgeoProxy

  const menuItems: ContextMenuItem[] = [
    ...(isViewable(obj.class)
      ? [{ label: 'View/Edit', onClick: handleViewEdit }]
      : []),
    ...(isInMemorySf
      ? [{ label: 'Send to spatial editor', onClick: handleSendSfToSpatial }]
      : []),
    ...(isSpatialProxy
      ? [{ label: 'Send to spatial editor', onClick: handleSendToSpatial }]
      : []),
    { label: 'Remove', onClick: handleRemove },
    {
      label: 'Rename',
      onClick: () => {
        setRenameValue(obj.name)
        setRenaming(true)
      }
    },
    {
      label: 'Make Copy',
      onClick: () => {
        setCopyName(obj.name + '_copy')
        setCopying(true)
      }
    },
    ...(moveSubmenu.length > 0 ? [{ label: 'Move To', submenu: moveSubmenu }] : []),
    { label: 'Save to database', submenu: dbSubmenu },
    ...(isTabularExportable(obj.class) || isVectorExportable(obj.class)
      ? [
          { separator: true } as ContextMenuItem,
          {
            label: 'Export',
            submenu: [
              { label: 'Export as CSV',          onClick: () => handleExport('csv') },
              { label: 'Export as Text (.txt)',   onClick: () => handleExport('txt') },
              { label: 'Export as Excel (.xlsx)', onClick: () => handleExport('xlsx') },
            ]
          }
        ]
      : obj.class === 'function'
      ? [
          { separator: true } as ContextMenuItem,
          { label: 'Export as .R file', onClick: () => handleExport('r') }
        ]
      : []),
  ]

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  const paddingLeft = 8 + depth * 12

  if (renaming) {
    return (
      <div className="flex items-center px-2 py-0.5" style={{ paddingLeft }}>
        <input
          ref={renameRef}
          className="bg-geo-bg border border-geo-border rounded px-1 py-0.5 text-xs text-foreground outline-none w-full"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRename()
            if (e.key === 'Escape') setRenaming(false)
          }}
          onBlur={() => setRenaming(false)}
        />
      </div>
    )
  }

  if (copying) {
    return (
      <div className="flex items-center gap-1 px-2 py-0.5" style={{ paddingLeft }}>
        <input
          ref={copyRef}
          className="bg-geo-bg border border-geo-border rounded px-1 py-0.5 text-xs text-foreground outline-none flex-1 min-w-0"
          value={copyName}
          onChange={(e) => setCopyName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleCopy()
            if (e.key === 'Escape') setCopying(false)
          }}
          onBlur={() => setCopying(false)}
        />
      </div>
    )
  }

  return (
    <>
      <div
        className="flex items-center gap-1 px-2 py-0.5 hover:bg-geo-bg/50 cursor-default group"
        style={{ paddingLeft }}
        onContextMenu={handleContextMenu}
        onClick={() => (obj.isEnvironment || obj.isList) && setExpanded(!expanded)}
      >
        {obj.isEnvironment || obj.isList ? (
          expanded ? (
            <ChevronDown className="w-3 h-3 text-geo-muted flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 text-geo-muted flex-shrink-0" />
          )
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}
        {obj.class === 'tbl_dbi' && (
          <Database className="w-3 h-3 text-geo-accent flex-shrink-0" />
        )}
        {obj.rgeoProxy && (
          <Link2
            className="w-3 h-3 text-geo-accent flex-shrink-0"
            aria-label="Connected to .Rgeo database"
          />
        )}
        <span className="text-xs text-foreground truncate min-w-0">{obj.name}</span>
        <span className="text-[10px] text-geo-accent flex-shrink-0 ml-auto">{obj.class}</span>
        {obj.size > 0 && (
          <span className="text-[10px] text-geo-muted flex-shrink-0 ml-1">{formatSize(obj.size)}</span>
        )}
      </div>
      {obj.preview && (
        <div
          className="text-[10px] text-geo-muted truncate px-2 -mt-0.5"
          style={{ paddingLeft: paddingLeft + 15 }}
          title={obj.preview}
        >
          {obj.preview}
        </div>
      )}
      {(obj.isEnvironment || obj.isList) && expanded && obj.children?.map((child, idx) => {
        let childAccessPath: string
        if (obj.isEnvironment) {
          // Environment children live in their own scope
          childAccessPath = child.name
        } else {
          // List children: use $ for named, [[ ]] for unnamed
          const isUnnamed = child.name.startsWith('[[')
          childAccessPath = isUnnamed
            ? `${currentAccessPath}${child.name}`
            : `${currentAccessPath}$${child.name}`
        }
        return (
          <EnvironmentItem
            key={`${child.name}-${idx}`}
            obj={child}
            envName={obj.isEnvironment ? obj.name : envName}
            allEnvironments={allEnvironments}
            onRefresh={onRefresh}
            depth={depth + 1}
            accessPath={childAccessPath}
          />
        )
      })}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={menuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
      {conflictPrompt && (
        <SaveConflictDialog
          objectName={obj.name}
          databaseName={`${basenameRgeo(conflictPrompt.filePath)}.Rgeo`}
          existingNames={conflictPrompt.existingNames}
          onResolve={(d) => conflictPrompt.resolve(d)}
        />
      )}
    </>
  )
}
