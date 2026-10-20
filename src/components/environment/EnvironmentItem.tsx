import React, { useState, useRef, useEffect } from 'react'
import { Box, ChevronRight, ChevronDown, Database, Link2 } from 'lucide-react'
import type { RObjectInfo } from '@/lib/r-client'
import { ContextMenu, type ContextMenuItem } from '../ui/context-menu'
import { useSessionStore } from '@/store/session'
import { useEditorStore } from '@/store/editor'
import { useDatabaseStore, type OpenDb } from '@/store/database'
import { useEnvironmentStore } from '@/store/environment'
import {
  duplicateCode, moveTargets, placementOf, GLOBAL_ENV, type PanelEnv,
} from '@/lib/environments'
import { exportEnvironments } from '@/lib/env-export'
import { placementMenu, workHereItem } from './env-menu'
import { type SpatialLayer } from '@/store/spatial'
import { rClient } from '@/lib/r-client'
import { useProjectStore } from '@/store/project'
import { confirmProjectFileReplace } from '@/store/project-file-replace'
import { destinationExpr, projectFileName, TABLE_EXTENSION, writeTableCode, type FileDestination, type TableFormat } from '@/lib/project-file-code'
import { SaveConflictDialog, type SaveConflictDecision } from '../database/SaveConflictDialog'
import { AlreadyOnMapDialog } from '../spatial/AlreadyOnMapDialog'
import {
  focusMapLayer, mapLayersForObject, sendDbObjectToMap, sendObjectToMap,
} from '@/lib/spatial-link'
import {
  VIEWABLE_DATA_CLASSES,
  VIEWABLE_VECTOR_CLASSES,
  VIEWABLE_MATRIX_CLASS,
  SF_CLASSES,
  isViewable,
  isTabularExportable,
  isVectorExportable,
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

interface EnvironmentItemProps {
  obj: RObjectInfo
  envName: string
  allEnvironments: PanelEnv[]
  onRefresh: () => void
  depth?: number
  accessPath?: string
}

function buildExportCode(
  accessPath: string,
  objName: string,
  cls: string,
  format: TableFormat | 'r',
  destination: FileDestination
): string {
  if (format === 'r') {
    return `writeLines(c(paste0("${objName} <- ", paste(deparse(${accessPath}), collapse = "\n")), ""), con = ${destinationExpr(destination)})`
  }

  const expr = isVectorExportable(cls)
    ? `data.frame(${objName} = ${accessPath})`
    : cls === VIEWABLE_MATRIX_CLASS
      ? `as.data.frame(${accessPath})`
      : accessPath

  return writeTableCode(expr, format, destination)
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
  const [alreadyOnMap, setAlreadyOnMap] = useState<SpatialLayer[]>([])
  const workspaceFolder = useDatabaseStore((s) => s.workspaceFolder)
  const projectNamed = useProjectStore((s) => s.path !== null)
  const userFilterActive = useEnvironmentStore((s) => s.userFilterActive)
  const envPlacement = useEnvironmentStore((s) => s.envPlacement)
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

  const reportFailure = (res: { success: boolean; error?: string }, what: string): boolean => {
    if (res.success) return true
    // Writing into an attached package is the common one — R locks those
    // bindings — and the old code discarded the answer, so the menu item did
    // nothing and said nothing.
    useSessionStore.getState().addConsoleEntry('error', res.error ?? `Could not ${what}.`)
    return false
  }

  const handleRemove = async () => {
    logToConsole(`rm("${obj.name}", envir = ${envName})`)
    const res = await rClient.envRemove(obj.name, envName)
    if (!reportFailure(res, `remove ${obj.name}`)) return
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
    const res = await rClient.envRename(obj.name, newName, envName)
    setRenaming(false)
    if (!reportFailure(res, `rename ${obj.name}`)) return
    onRefresh()
  }

  const handleCopy = async (toEnv?: string) => {
    const name = copyName.trim() || obj.name + '_copy'
    const targetEnv = toEnv || envName
    setCopying(false)
    // An environment is a REFERENCE. `assign(new, get(old))` would give the
    // user a second name for the same environment and call it a copy — the
    // next edit through either one would show up in both.
    if (obj.isEnvironment) {
      logToConsole(duplicateCode(obj.name, name, envName))
      const res = await rClient.envDuplicate(obj.name, name, envName)
      if (!reportFailure(res, `copy ${obj.name}`)) return
      onRefresh()
      return
    }
    logToConsole(`assign("${name}", get("${obj.name}", envir = ${envName}), envir = ${targetEnv})`)
    const res = await rClient.envCopy(obj.name, envName, targetEnv, name)
    if (!reportFailure(res, `copy ${obj.name}`)) return
    onRefresh()
  }

  /**
   * Copy this object into another environment, keeping the original.
   *
   * Distinct from "Make Copy", which makes a second copy alongside it under a
   * new name: this one keeps the NAME and changes the place, so `roads` in
   * .GlobalEnv and `roads` in `env2` are the same data in two environments.
   * That is what a user reaches for when they are setting an environment up to
   * work in and do not want to lose what they had.
   */
  const handleCopyTo = async (toEnv: string) => {
    if (obj.isEnvironment) {
      // An environment is a reference; `assign` would put a second name on it.
      logToConsole(duplicateCode(obj.name, obj.name, envName, toEnv))
      const res = await rClient.envDuplicate(obj.name, obj.name, envName, toEnv)
      if (!reportFailure(res, `copy ${obj.name} to ${toEnv}`)) return
      onRefresh()
      return
    }
    logToConsole(
      `assign("${obj.name}", get("${obj.name}", envir = ${envName}), envir = ${toEnv})`)
    const res = await rClient.envCopy(obj.name, envName, toEnv, obj.name)
    if (!reportFailure(res, `copy ${obj.name} to ${toEnv}`)) return
    onRefresh()
  }

  const handleMove = async (toEnv: string) => {
    logToConsole(
      `assign("${obj.name}", get("${obj.name}", envir = ${envName}), envir = ${toEnv}); rm("${obj.name}", envir = ${envName})`
    )
    const res = await rClient.envMove(obj.name, envName, toEnv)
    if (!reportFailure(res, `move ${obj.name} to ${toEnv}`)) return
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

  // Both sends go through src/lib/spatial-link.ts, so an object put on the map
  // from here, from the data viewer's Add to Map button or by the AI assistant
  // arrives as the same layer, bound to the same session, with the map moved
  // to it the same way.
  const sendToSpatial = async () => {
    const proxy = obj.rgeoProxy
    try {
      if (proxy) {
        await sendDbObjectToMap({
          name: obj.name,
          handle: proxy.handle,
          proxyName: proxy.name,
          geometryType: proxy.geometryType,
          geometryColumn: proxy.geometryColumn,
          pkColumn: proxy.pkColumn,
          crs: proxy.crs
        })
      } else {
        await sendObjectToMap({ name: obj.name, envName, class: obj.class })
      }
    } catch (e) {
      useSessionStore
        .getState()
        .addConsoleEntry('error', `Could not add ${obj.name} to the map: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const handleSendToSpatial = () => {
    const existing = mapLayersForObject({ name: obj.name, envName: obj.rgeoProxy ? '' : envName })
    if (existing.length > 0) {
      setAlreadyOnMap(existing)
      return
    }
    void sendToSpatial()
  }

  const handleExport = async (format: TableFormat | 'r', target: 'disk' | 'project' = 'disk') => {
    if (!window.electronAPI) return
    let destination: FileDestination
    if (target === 'project') {
      // Named after the object, in "tables/": re-exporting the same object
      // updates its file rather than collecting copies, as writing over a file
      // on disk would. Renaming is the pane's job, or ourgeo_project_path()'s.
      // It is also how a re-export replaces a file the user imported under
      // the same name, so it asks first (unless told not to).
      destination = { kind: 'project', name: projectFileName(format === 'r' ? 'code' : 'tables', `${obj.name}.${format === 'r' ? 'R' : TABLE_EXTENSION[format]}`) }
      try { if (!await confirmProjectFileReplace(destination.name)) return }
      catch (e) { useSessionStore.getState().addConsoleEntry('error', `Project Files: ${e instanceof Error ? e.message : String(e)}`); return }
    } else {
      const filePath = await window.electronAPI.dialog.saveExportFile(format)
      if (!filePath) return
      destination = { kind: 'disk', path: filePath }
    }
    const code = buildExportCode(currentAccessPath, obj.name, obj.class, format, destination)
    logToConsole(code)
    const res = await rClient.execute(code)
    if (!res.success && res.error) {
      useSessionStore.getState().addConsoleEntry('error', res.error)
    }
  }

  // Where this object may be sent.
  //
  // With the panel's eye hiding what is not the user's, the list is what the
  // panel is showing: .GlobalEnv and the environments the user made. Turn the
  // eye off — "show me the whole session" — and every environment is offered,
  // package environments included; those usually refuse the write, which is why
  // the move reports what R said rather than appearing to do nothing.
  //
  // The old list was every environment REACHABLE by walking the tree, nested
  // ones included. Half of them could not be written to at all: the server
  // resolves a target by name in .GlobalEnv, so `inner` inside `myenv` came
  // back "Environment 'inner' not found".
  const targets = moveTargets(allEnvironments, envName, !userFilterActive)
  const moveSubmenu: ContextMenuItem[] = targets.length === 0
    ? [{ label: 'No other environment to move to', disabled: true }]
    : targets.map((name) => ({ label: name, onClick: () => handleMove(name) }))
  const copyToSubmenu: ContextMenuItem[] = targets.length === 0
    ? [{ label: 'No other environment to copy to', disabled: true }]
    : targets.map((name) => ({ label: name, onClick: () => handleCopyTo(name) }))

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

  // An environment the user made is listed here — as the object it is in
  // .GlobalEnv — or beside .GlobalEnv as a place of its own, never both. So
  // the row has to carry everything the group carries, or choosing "inside"
  // would quietly cost the user the ability to export it or move it back.
  const isTopLevelEnv = obj.isEnvironment && envName === GLOBAL_ENV

  const menuItems: ContextMenuItem[] = [
    ...(isViewable(obj.class)
      ? [{ label: 'View/Edit', onClick: handleViewEdit }]
      : []),
    ...(isTopLevelEnv
      ? [
          workHereItem(obj.name),
          { label: 'Export…', onClick: () => void exportEnvironments([obj.name]) },
          placementMenu(obj.name, placementOf(envPlacement, obj.name)),
        ]
      : []),
    ...(isInMemorySf || isSpatialProxy
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
    // Move To leaves nothing behind; Copy To leaves the original where it is.
    // Both are wanted, and which one a user means is not guessable.
    ...(copyToSubmenu.length > 0 ? [{ label: 'Copy To', submenu: copyToSubmenu }] : []),
    // A .Rgeo holds datasets. An environment is a container of them, and the
    // import would fail on the first attempt to work out its columns.
    ...(obj.isEnvironment ? [] : [{ label: 'Save to database', submenu: dbSubmenu }]),
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
          },
          // Offered only in a named project: scratch has no file library, and
          // an item that runs only to be refused by R is a dead end.
          ...(projectNamed ? [{
            label: 'Export to Project Files',
            submenu: [
              { label: 'CSV',          onClick: () => handleExport('csv', 'project') },
              { label: 'Text (.txt)',   onClick: () => handleExport('txt', 'project') },
              { label: 'Excel (.xlsx)', onClick: () => handleExport('xlsx', 'project') },
            ]
          }] : [])
        ]
      : obj.class === 'function'
      ? [
          { separator: true } as ContextMenuItem,
          { label: 'Export as .R file', onClick: () => handleExport('r') },
          ...(projectNamed ? [{ label: 'Export .R file to Project Files', onClick: () => handleExport('r', 'project') }] : [])
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
        {/* The same icon the environment's own group carries, so the row and
            the group beside .GlobalEnv read as the one thing they are. */}
        {obj.isEnvironment && (
          <Box className="w-3 h-3 text-geo-accent flex-shrink-0" aria-label="Environment" />
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

      <AlreadyOnMapDialog
        name={alreadyOnMap.length > 0 ? obj.name : null}
        count={alreadyOnMap.length}
        onCancel={() => setAlreadyOnMap([])}
        onShowExisting={() => { focusMapLayer(alreadyOnMap[0].id); setAlreadyOnMap([]) }}
        onAddAgain={() => { setAlreadyOnMap([]); void sendToSpatial() }}
      />
    </>
  )
}
