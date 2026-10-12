import { DataChecksPanel } from '@/components/toolbox/DataChecksPanel'
import { VectorExportDialog } from './VectorExportDialog'
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { flushSync } from 'react-dom'
import * as Dialog from '@radix-ui/react-dialog'
import { RefreshCw, Filter, ListFilter, MousePointer2, Database, Pencil, Plus, Locate, Maximize2, Map as MapIcon } from 'lucide-react'
import { Button } from '../ui/button'
import { ContextMenu } from '../ui/context-menu'
import { rClient, type ColumnInfo } from '@/lib/r-client'
import { featuresBbox, layerExtentBbox } from '@/lib/layer-bbox'
import { useEnvironmentStore } from '@/store/environment'
import { useSessionStore } from '@/store/session'
import { useGeometryEditStore, selectActiveSession } from '@/store/geometryEdit'
import type { GeometryType } from '@/store/geometryEdit'
import {
  registerDataViewerRefresh,
  unregisterDataViewerRefresh,
  registerDataViewerCellUpdate,
  unregisterDataViewerCellUpdate,
  type DataViewerCellUpdate,
} from '@/lib/data-viewer-refresh'
import { useSpatialStore, type SpatialLayer } from '@/store/spatial'
import { useSelectionStore } from '@/store/selection'
import { useAddFeature } from '@/hooks/useAddFeature'
import { useShallow } from 'zustand/react/shallow'
import { SelectionQueryDialog } from '@/components/spatial/SelectionQueryDialog'
import { AlreadyOnMapDialog } from '@/components/spatial/AlreadyOnMapDialog'
import {
  dbSpatialRefFor, focusMapLayer, mapLayersForObject, sendDbObjectToMap, sendObjectToMap,
} from '@/lib/spatial-link'
import { SF_CLASSES } from '@/lib/validators'
import { ColumnTypeDropdown } from './ColumnTypeDropdown'
import { AddColumnDialog } from './AddColumnDialog'
import {
  GEOM_TYPES,
  getGeomType,
  isGeomColumn,
  EMPTY,
  ROW_HEIGHT,
  CHUNK_SIZE,
  ROW_NUM_WIDTH,
  ADD_BTN_WIDTH,
  MIN_COL_WIDTH,
  estimateColWidth,
  findRgeoProxy,
  nextCell,
  editInitialValue,
  type EditingCell,
} from './dataViewerShared'

export function DataFrameView({
  name,
  envName,
  accessPath,
  cls
}: {
  name: string
  envName: string
  accessPath: string
  cls: string
}): React.ReactElement {
  const [showDataChecks, setShowDataChecks] = useState(false)
  const [showVectorExport, setShowVectorExport] = useState(false)
  const [columns, setColumns] = useState<ColumnInfo[]>([])
  const [rows, setRows] = useState<Map<number, string[]>>(new Map())
  const [totalRows, setTotalRows] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<EditingCell | null>(null)
  const [renamingCol, setRenamingCol] = useState<{ name: string; draft: string } | null>(null)
  const [addColOpen, setAddColOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const headerInnerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const loadedChunks = useRef<Set<number>>(new Set())
  const colInitialized = useRef(false)
  const handledByKeyRef = useRef(false)
  const cancelRenameRef = useRef(false)
  const [colWidths, setColWidths] = useState<number[]>([])
  const [colOrder, setColOrder] = useState<number[]>([])
  const [draggingCol, setDraggingCol] = useState<number | null>(null)
  const [dragOverCol, setDragOverCol] = useState<{ pos: number; side: 'left' | 'right' } | null>(null)
  const draggingColRef = useRef<number | null>(null)
  const dragOverColRef = useRef<{ pos: number; side: 'left' | 'right' } | null>(null)
  const lastHeaderClickRef = useRef<{ pos: number; time: number } | null>(null)
  const [draggingRow, setDraggingRow] = useState<number | null>(null)
  const [dragOverRow, setDragOverRow] = useState<{ rowIdx: number; side: 'top' | 'bottom' } | null>(null)
  const draggingRowRef = useRef<number | null>(null)
  const dragOverRowRef = useRef<{ rowIdx: number; side: 'top' | 'bottom' } | null>(null)
  const rowDragStartY = useRef<number | null>(null)
  const addEntry = useSessionStore((s) => s.addConsoleEntry)
  const addInputHistory = useSessionStore((s) => s.addInputHistory)
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; rowIdx: number; col: ColumnInfo
  } | null>(null)
  const startEditing = useGeometryEditStore((s) => s.startEditing)
  const setEditMode = useGeometryEditStore((s) => s.setEditMode)
  const geoSession = useGeometryEditStore(selectActiveSession)
  const ensureOpen = useSpatialStore((s) => s.ensureOpen)
  const { addFeatureAndDraw } = useAddFeature()
  const spatialLayers = useSpatialStore((s) => s.layers)
  const removeLayerFeatures = useSpatialStore((s) => s.removeLayerFeatures)

  // Resolve once whether this dataset is a database-backed proxy. When set,
  // every fetch/edit goes through /dataset/* instead of executing R code.
  const environments = useEnvironmentStore((s) => s.environments)
  const proxy = useMemo(
    () => findRgeoProxy(environments, envName, accessPath),
    [environments, envName, accessPath]
  )
  const pkColRef = useRef<string>('_rgeo_rowid')
  const pkValuesRef = useRef<Map<number, number>>(new Map())

  const [addRowDialogOpen, setAddRowDialogOpen] = useState(false)
  const [autoAddRow, setAutoAddRow] = useState(false)
  const [pendingAddRowCol, setPendingAddRowCol] = useState(0)
  const [addFeatureMenu, setAddFeatureMenu] = useState<{ x: number; y: number; col: ColumnInfo } | null>(null)
  const [colHeaderMenu, setColHeaderMenu] = useState<{ x: number; y: number; colName: string } | null>(null)
  const [rowHeaderMenu, setRowHeaderMenu] = useState<{ x: number; y: number; rowIdx: number } | null>(null)
  const [showOnlySelected, setShowOnlySelected] = useState(false)
  const [queryDialogOpen, setQueryDialogOpen] = useState(false)
  const [rowSelectMode, setRowSelectMode] = useState(false)
  const clearSelection = useSelectionStore((s) => s.clearSelection)
  const selKey = `${accessPath}::${envName}`
  const selectedIndices = useSelectionStore(useShallow((s) => s.selections[selKey] ?? EMPTY))
  const hasSelection = selectedIndices.length > 0
  const matchingLayer = spatialLayers.find((l) => l.name === accessPath && l.envName === envName) ?? null

  // Layers already showing this dataset, resolved when the button is pressed
  // rather than watched: the answer is only needed at that moment, and holding
  // it in state would mean deciding what to do when it changes underneath.
  const [alreadyOnMap, setAlreadyOnMap] = useState<SpatialLayer[]>([])
  const selectionAnchorRef = useRef<number | null>(null)
  const selectionFromClickRef = useRef(false)
  const fitMapToBbox = useSpatialStore((s) => s.fitMapToBbox)

  // Zoom the spatial editor to the geometry of specific rows (by absolute row
  // index) of the matching map layer. Opens the spatial panel if closed.
  const zoomToRows = useCallback((indices: number[]) => {
    if (!matchingLayer) return
    const bbox = featuresBbox(indices.map((i) => matchingLayer.geojson.features[i]))
    if (!bbox) return
    ensureOpen()
    fitMapToBbox(bbox)
  }, [matchingLayer, ensureOpen, fitMapToBbox])

  const zoomToLayerExtent = useCallback(() => {
    if (!matchingLayer) return
    const bbox = layerExtentBbox(matchingLayer)
    if (!bbox) return
    ensureOpen()
    fitMapToBbox(bbox)
  }, [matchingLayer, ensureOpen, fitMapToBbox])

  // Put this dataset on the map. The .Rgeo case has to go the other way round
  // from the in-memory one — a lazy tbl has no geometry in the session to read
  // — so the proxy is looked up first and decides which path runs.
  const sendToMap = useCallback(async () => {
    const geom = columns.find((c) => isGeomColumn(c.type))
    try {
      const dbRef = dbSpatialRefFor(environments, accessPath, envName)
      if (dbRef) {
        await sendDbObjectToMap(dbRef)
        return
      }
      // The library follows the GEOMETRY COLUMN, not the object's class: a
      // plain data.frame can carry an sfc column, and calling that one geos
      // would send every edit saved from the map through the wrong writer.
      const klass = SF_CLASSES.includes(cls)
        ? cls
        : geom?.type.startsWith('sfc_') ? 'sf' : cls
      await sendObjectToMap({
        name: accessPath, envName, class: klass, sfColumn: geom?.name ?? null,
      })
    } catch (e) {
      addEntry('error', `Could not add ${accessPath} to the map: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [accessPath, envName, cls, columns, environments, addEntry])

  const handleSendToMap = useCallback(() => {
    const existing = mapLayersForObject({ name: accessPath, envName })
    if (existing.length > 0) {
      setAlreadyOnMap(existing)
      return
    }
    void sendToMap()
  }, [accessPath, envName, sendToMap])

  const fetchChunk = useCallback(
    async (offset: number, sync = false) => {
      // `sync` forces the resulting state update to commit synchronously via
      // flushSync. A plain re-fetch triggered from a mutation handler (type
      // change, add/rename/delete column, geometry save) was getting swallowed
      // — its setState raced with a concurrent store-driven re-render and never
      // painted, so the grid only updated on a manual Refresh. flushSync wins
      // that race. Scroll-driven fetches pass sync=false to stay cheap.
      const commit = (fn: () => void) => (sync ? flushSync(fn) : fn())
      const chunkKey = Math.floor(offset / CHUNK_SIZE)
      if (loadedChunks.current.has(chunkKey)) return
      loadedChunks.current.add(chunkKey)

      try {
        if (proxy) {
          // Database-backed proxy: chunked SQL via /dataset/preview. The
          // first column of every response is the synthetic rowid (PK)
          // which we strip from display but cache for cell-edit routing.
          const res = await rClient.datasetPreview(proxy, { offset, limit: CHUNK_SIZE })
          if (res.success && res.columns && res.rows) {
            const pkCol = res.pkColumn ?? '_rgeo_rowid'
            pkColRef.current = pkCol
            const pkIdx = res.columns.findIndex((c) => c.name === pkCol)
            const visibleColumns = pkIdx >= 0
              ? res.columns.filter((_, i) => i !== pkIdx)
              : res.columns
            const visibleRows: (string | null)[][] = res.rows.map((row) =>
              pkIdx >= 0 ? row.filter((_, i) => i !== pkIdx) : row
            )
            // Cache pk values keyed by absolute row index so cell edits can
            // address rows by _rgeo_rowid even after sorting.
            if (pkIdx >= 0) {
              res.rows.forEach((row, i) => {
                const v = row[pkIdx]
                if (v != null) {
                  const n = Number(v)
                  if (!Number.isNaN(n)) pkValuesRef.current.set(offset + i, n)
                }
              })
            }
            commit(() => {
              setColumns(visibleColumns)
              setTotalRows(res.totalRows ?? visibleRows.length)
              setRows((prev) => {
                const next = new Map(prev)
                visibleRows.forEach((row, i) => next.set(offset + i, row.map((v) => v ?? 'NA')))
                return next
              })
              if (!colInitialized.current && visibleColumns.length > 0) {
                colInitialized.current = true
                const widths = visibleColumns.map((col, i) =>
                  estimateColWidth(col.name, visibleRows.slice(0, 50).map((row) => row[i] ?? ''))
                )
                setColWidths(widths)
                setColOrder(visibleColumns.map((_, i) => i))
              }
            })
          }
          return
        }
        if (cls === 'tbl_dbi') {
          // Legacy lazy db tbl (no proxy registered yet): single-window preview.
          if (offset !== 0) return
          const res = await rClient.dbPreviewTbl(accessPath, 500)
          if (res.success && res.columns && res.rows) {
            commit(() => {
              setColumns(res.columns!)
              setTotalRows(res.rows!.length)
              setRows((prev) => {
                const next = new Map(prev)
                res.rows!.forEach((row, i) => next.set(i, row.map((v) => v ?? 'NA')))
                return next
              })
              if (!colInitialized.current && res.columns!.length > 0) {
                colInitialized.current = true
                const widths = res.columns!.map((col, i) =>
                  estimateColWidth(col.name, (res.rows as (string | null)[][]).slice(0, 50).map((row) => row[i] ?? ''))
                )
                setColWidths(widths)
                setColOrder(res.columns!.map((_, i) => i))
              }
            })
          }
          return
        }
        const res = await rClient.getObjectDataFrame(name, envName, accessPath, offset, CHUNK_SIZE)
        if (res.success) {
          commit(() => {
            setColumns(res.columns)
            setTotalRows(res.totalRows)
            setRows((prev) => {
              const next = new Map(prev)
              res.rows.forEach((row, i) => next.set(offset + i, row))
              return next
            })
            if (!colInitialized.current && res.columns.length > 0) {
              colInitialized.current = true
              const widths = res.columns.map((col, i) =>
                estimateColWidth(col.name, res.rows.map(row => row[i] ?? ''))
              )
              setColWidths(widths)
              setColOrder(res.columns.map((_, i) => i))
            }
          })
        }
      } catch {
        loadedChunks.current.delete(chunkKey)
      }
    },
    [name, envName, accessPath, cls, proxy]
  )

  const refresh = useCallback(() => {
    setLoading(true)
    setError(null)
    loadedChunks.current.clear()
    colInitialized.current = false
    fetchChunk(0, true)
      .then(() => setError(null))
      .catch(() => setError('Failed to load data'))
      .finally(() => setLoading(false))
  }, [fetchChunk])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Reset cell auto-add when editing stops
  useEffect(() => { if (!editing) setAutoAddRow(false) }, [editing])

  const handleAddRow = useCallback(
    async (colIdx?: number) => {
      const code = `${accessPath}[nrow(${accessPath}) + 1L, ] <- NA`
      addEntry('input', code)
      addInputHistory(code)
      const newRowIdx = totalRows
      const newTotal = totalRows + 1
      try {
        const res = await rClient.execute(code)
        if (!res.success) {
          addEntry('error', res.error || 'Failed to add row')
          setAddRowDialogOpen(false)
          setEditing(null)
          refresh()
          return
        }
      } catch (e) {
        addEntry('error', String(e))
        setAddRowDialogOpen(false)
        setEditing(null)
        refresh()
        return
      }
      setTotalRows(newTotal)
      loadedChunks.current.delete(Math.floor(newRowIdx / CHUNK_SIZE))
      fetchChunk(Math.floor(newRowIdx / CHUNK_SIZE) * CHUNK_SIZE)
      setAddRowDialogOpen(false)
      setAutoAddRow(true)
      setEditing({ row: newRowIdx, col: colIdx ?? 0, value: '', originalValue: '' })
    },
    [accessPath, totalRows, addEntry, addInputHistory, fetchChunk, refresh]
  )

  // Register a direct (non-reactive) refresh callback for point-add and
  // row-append notifications from the geometry drawing workflow.
  useEffect(() => {
    registerDataViewerRefresh(accessPath, envName, refresh)
    return () => unregisterDataViewerRefresh(accessPath, envName)
  }, [accessPath, envName, refresh])

  // Targeted geometry-cell updates from Save Edits: patch just the edited
  // rows' geometry cells with their new value, no re-fetch.
  useEffect(() => {
    const apply = (updates: DataViewerCellUpdate[]) => {
      setRows((prev) => {
        const next = new Map(prev)
        for (const u of updates) {
          const origIdx = columns.findIndex((c) => c.name === u.columnName)
          const existing = next.get(u.rowIdx)
          if (origIdx < 0 || !existing) continue
          const nextRow = existing.slice()
          nextRow[origIdx] = u.value
          next.set(u.rowIdx, nextRow)
        }
        return next
      })
    }
    registerDataViewerCellUpdate(accessPath, envName, apply)
    return () => unregisterDataViewerCellUpdate(accessPath, envName)
  }, [accessPath, envName, columns])

  /** Open the spatial editor drawing geometry for an existing row's geometry cell. */
  const startDrawGeometry = useCallback(
    (rowIdx: number, col: ColumnInfo, geomTypeOverride?: GeometryType) => {
      const geomType = geomTypeOverride ?? getGeomType(col.type)
      if (!geomType) return
      const baseName = accessPath.split('$')[0]
      const layer = spatialLayers.find((l) => l.name === baseName && l.envName === envName)
      setEditMode(false)
      ensureOpen()
      startEditing({
        accessPath,
        envName,
        columnName: col.name,
        colLib: col.type.startsWith('sfc_') ? 'sf' : 'geos',
        geometryType: geomType,
        currentRow: rowIdx,
        totalRows,
        originalGeometry: layer?.geojson.features[rowIdx]?.geometry ?? null
      })
    },
    [accessPath, envName, totalRows, spatialLayers, setEditMode, ensureOpen, startEditing]
  )

  /** Append a row and immediately draw its geometry (＋ Add Feature button). */
  const handleAddFeature = useCallback(
    (e: React.MouseEvent, col: ColumnInfo) => {
      const geomType = getGeomType(col.type)
      if (geomType) {
        void addFeatureAndDraw({
          accessPath,
          envName,
          columnName: col.name,
          colLib: col.type.startsWith('sfc_') ? 'sf' : 'geos',
          geometryType: geomType,
          totalRows
        })
      } else {
        // Geometry type not derivable from the column (geos) — ask via menu
        setAddFeatureMenu({ x: e.clientX, y: e.clientY, col })
      }
    },
    [accessPath, envName, totalRows, addFeatureAndDraw]
  )

  // Fetch visible chunks on scroll
  useEffect(() => {
    if (totalRows === 0) return
    const startRow = Math.floor(scrollTop / ROW_HEIGHT)
    const viewportHeight = scrollRef.current?.clientHeight || 600
    const endRow = Math.min(startRow + Math.ceil(viewportHeight / ROW_HEIGHT) + 5, totalRows - 1)

    const startChunk = Math.floor(startRow / CHUNK_SIZE) * CHUNK_SIZE
    const endChunk = Math.floor(endRow / CHUNK_SIZE) * CHUNK_SIZE
    for (let c = startChunk; c <= endChunk; c += CHUNK_SIZE) {
      fetchChunk(c)
    }
  }, [scrollTop, totalRows, fetchChunk])

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return
    setScrollTop(scrollRef.current.scrollTop)
    if (headerInnerRef.current) {
      headerInnerRef.current.style.transform = `translateX(-${scrollRef.current.scrollLeft}px)`
    }
  }, [])

  // Auto-scroll to active geometry row
  useEffect(() => {
    if (!geoSession || geoSession.accessPath !== accessPath || geoSession.envName !== envName) return
    const targetTop = geoSession.currentRow * ROW_HEIGHT
    const viewport = scrollRef.current
    if (!viewport) return
    const { scrollTop: st, clientHeight } = viewport
    if (targetTop < st || targetTop + ROW_HEIGHT > st + clientHeight) {
      viewport.scrollTop = targetTop - clientHeight / 2
    }
  }, [geoSession?.currentRow, accessPath, envName, geoSession])

  // Write a single cell's display value into local state. Used both for the
  // optimistic pre-commit update and for reverting when R rejects the edit.
  const setCellValue = useCallback((rowIdx: number, origIdx: number, value: string) => {
    setRows((prev) => {
      const existing = prev.get(rowIdx)
      if (!existing) return prev
      const nextRow = existing.slice()
      nextRow[origIdx] = value
      const next = new Map(prev)
      next.set(rowIdx, nextRow)
      return next
    })
  }, [])

  const handleCellEdit = useCallback(
    async (rowIdx: number, colIdx: number, rawValue: string) => {
      const origIdx = colOrder.length > 0 ? colOrder[colIdx] : colIdx
      const col = columns[origIdx]
      if (!col) return

      // An emptied input means "no value" → NA, not the literal string "" (so
      // clearing a cell, or committing an NA cell you opened but didn't type
      // into, writes NA back rather than an empty character value).
      const value = rawValue === '' ? 'NA' : rawValue

      // Optimistically reflect the new value in the grid the instant the edit
      // is committed — no whole-chunk re-fetch (that was both a per-keystroke
      // performance cost and, called after the R round-trip await, did not
      // repaint the cell). The value the user typed is authoritative for the
      // display; we only roll it back if R actually rejects the write.
      const prevValue = rows.get(rowIdx)?.[origIdx] ?? 'NA'
      setCellValue(rowIdx, origIdx, value)

      if (proxy) {
        const rowId = pkValuesRef.current.get(rowIdx)
        if (rowId == null) {
          setCellValue(rowIdx, origIdx, prevValue)
          addEntry('error', `Cannot edit row ${rowIdx + 1}: missing rowid (try refreshing)`)
          return
        }
        const sqlValue: string | number | null =
          value === 'NA' ? null
            : ['numeric', 'integer', 'double'].includes(col.type) ? Number(value)
            : value
        const res = await rClient.datasetUpdateCell(proxy, rowId, col.name, sqlValue)
        if (!res.success && res.error) {
          setCellValue(rowIdx, origIdx, prevValue)
          addEntry('error', res.error)
        }
        return
      }

      const colType = col.type
      const needsQuote = ['character', 'factor'].includes(colType)
      const rValue = value === 'NA' ? 'NA' : needsQuote ? `"${value.replace(/"/g, '\\"')}"` : value
      const code = `${accessPath}[${rowIdx + 1}, "${col.name}"] <- ${rValue}`

      addEntry('input', code)
      addInputHistory(code)
      try {
        const res = await rClient.execute(code)
        if (!res.success && res.error) {
          setCellValue(rowIdx, origIdx, prevValue)
          addEntry('error', res.error)
        }
      } catch (err) {
        setCellValue(rowIdx, origIdx, prevValue)
        addEntry('error', String(err))
      }
    },
    [columns, colOrder, rows, accessPath, addEntry, addInputHistory, proxy, setCellValue]
  )

  const handleTypeChange = useCallback(
    async (colName: string, newType: string) => {
      const convertFn = newType === 'Date' ? 'as.Date' : `as.${newType}`
      const code = `${accessPath}$${colName} <- ${convertFn}(${accessPath}$${colName})`

      // Optimistically reflect the new column type immediately. This drives the
      // cell-edit code generation (character/factor columns quote their value,
      // numeric/etc. don't) — waiting on a re-fetch left the grid on the old
      // type, so typing text into a freshly-numeric column emitted unquoted,
      // syntactically invalid R until a manual refresh.
      const prevType = columns.find((c) => c.name === colName)?.type
      setColumns((prev) => prev.map((c) => (c.name === colName ? { ...c, type: newType } : c)))

      addEntry('input', code)
      addInputHistory(code)
      try {
        const res = await rClient.execute(code)
        if (!res.success && res.error) {
          addEntry('error', res.error)
          if (prevType) setColumns((prev) => prev.map((c) => (c.name === colName ? { ...c, type: prevType } : c)))
          return
        }
        // Conversion succeeded. A one-shot reconcile picks up any value
        // reformatting (e.g. as.Date, or invalid coercions that became NA);
        // the optimistic type above already fixed the code-gen path instantly.
        refresh()
      } catch (err) {
        addEntry('error', String(err))
        if (prevType) setColumns((prev) => prev.map((c) => (c.name === colName ? { ...c, type: prevType } : c)))
      }
    },
    [accessPath, columns, addEntry, addInputHistory, refresh]
  )

  const handleRenameColumn = useCallback(
    async (oldName: string, newName: string) => {
      const trimmed = newName.trim()
      if (!trimmed || trimmed === oldName) {
        setRenamingCol(null)
        return
      }
      if (proxy) {
        const res = await rClient.datasetRenameColumn(proxy, oldName, trimmed)
        if (!res.success && res.error) addEntry('error', res.error)
        setRenamingCol(null)
        refresh()
        return
      }
      const code =
        cls === 'data.table'
          ? `data.table::setnames(${accessPath}, "${oldName}", "${trimmed}")`
          : `names(${accessPath})[names(${accessPath}) == "${oldName}"] <- "${trimmed}"`
      addEntry('input', code)
      addInputHistory(code)
      try {
        const res = await rClient.execute(code)
        if (!res.success && res.error) addEntry('error', res.error)
      } catch (err) {
        addEntry('error', String(err))
      } finally {
        setRenamingCol(null)
        refresh()
      }
    },
    [cls, accessPath, addEntry, addInputHistory, refresh, proxy]
  )

  const handleAddColumn = useCallback(
    async (
      code: string,
      _newObjectClass?: string,
      opts?: { formula?: string; newColumn?: string; newColumnType?: string }
    ) => {
      if (proxy && opts?.formula && opts?.newColumn) {
        const res = await rClient.datasetAddColumn(proxy, opts.newColumn, opts.formula)
        if (!res.success && res.error) {
          addEntry('error', res.error)
        } else if (res.used_pushdown === false) {
          addEntry('output', `[Rgeo] Computed '${opts.newColumn}' in R then wrote back to database.\n`)
        }
        refresh()
        return
      }

      const newCol = opts?.newColumn
      const newType = opts?.newColumnType
      // Optimistically append just the new column — no whole-object re-fetch of
      // the existing data. A rename/convert instead reassigns the object, so we
      // only take this path for a genuinely new column name.
      const optimistic = !!newCol && !!newType && !columns.some((c) => c.name === newCol)
      const newIdx = columns.length
      if (optimistic) {
        setColumns((prev) => [...prev, { name: newCol!, type: newType! }])
        setColOrder((prev) => [...prev, newIdx])
        setColWidths((prev) => [...prev, estimateColWidth(newCol!, [])])
        setRows((prev) => {
          const next = new Map<number, string[]>()
          prev.forEach((row, k) => next.set(k, [...row, 'NA']))
          return next
        })
      }

      addEntry('input', code)
      addInputHistory(code)
      try {
        const res = await rClient.execute(code)
        if (!res.success && res.error) {
          addEntry('error', res.error)
          if (optimistic) {
            // Roll back the optimistic column.
            setColumns((prev) => prev.filter((c) => c.name !== newCol))
            setColOrder((prev) => prev.filter((i) => i !== newIdx))
            setColWidths((prev) => prev.slice(0, -1))
            setRows((prev) => {
              const next = new Map<number, string[]>()
              prev.forEach((row, k) => next.set(k, row.slice(0, newIdx)))
              return next
            })
          } else {
            refresh()
          }
          return
        }
        if (!optimistic) {
          // Structure changed unpredictably (convert/rename) — reload.
          refresh()
          return
        }
        // An empty (no-formula) column is all NA — the optimistic placeholder is
        // already correct, so skip the fetch entirely. Only a computed column
        // needs its real values, and that's a single-column fetch which never
        // touches the other columns' data.
        if (opts?.formula) {
          try {
            const vres = await rClient.getObjectVector(
              name, envName, `${accessPath}[["${newCol}"]]`, 0, totalRows || CHUNK_SIZE
            )
            if (vres.success && vres.values) {
              const vals = vres.values
              setRows((prev) => {
                const next = new Map(prev)
                prev.forEach((row, k) => {
                  if (k < vals.length) {
                    const nr = row.slice()
                    nr[newIdx] = vals[k] ?? 'NA'
                    next.set(k, nr)
                  }
                })
                return next
              })
              // Reconcile the type from what R actually produced.
              if (vres.type) setColumns((prev) => prev.map((c) => (c.name === newCol ? { ...c, type: vres.type } : c)))
            }
          } catch {
            // The column is already added and visible; only its computed values
            // failed to load. Non-fatal — a manual Refresh will fill them in.
          }
        }
      } catch (err) {
        addEntry('error', String(err))
        if (!optimistic) refresh()
      }
    },
    [columns, name, envName, accessPath, totalRows, addEntry, addInputHistory, refresh, proxy]
  )

  const handleDeleteColumn = useCallback(
    async (colName: string) => {
      if (proxy) {
        const res = await rClient.datasetDeleteColumn(proxy, colName)
        if (!res.success && res.error) addEntry('error', res.error)
        setColHeaderMenu(null)
        refresh()
        return
      }
      const code = `${accessPath}[["${colName}"]] <- NULL`
      addEntry('input', code)
      addInputHistory(code)
      try {
        const res = await rClient.execute(code)
        if (!res.success && res.error) addEntry('error', res.error)
      } catch (err) {
        addEntry('error', String(err))
      } finally {
        setColHeaderMenu(null)
        refresh()
      }
    },
    [accessPath, addEntry, addInputHistory, refresh]
  )

  const handleDeleteRow = useCallback(
    async (rowIdx: number) => {
      const code = `${accessPath} <- ${accessPath}[-${rowIdx + 1}L, , drop = FALSE]`
      addEntry('input', code)
      addInputHistory(code)
      try {
        const res = await rClient.execute(code)
        if (res.success) {
          if (matchingLayer) removeLayerFeatures(matchingLayer.id, [rowIdx])
        } else if (res.error) {
          addEntry('error', res.error)
        }
      } catch (err) {
        addEntry('error', String(err))
      } finally {
        setRowHeaderMenu(null)
        refresh()
      }
    },
    [accessPath, addEntry, addInputHistory, refresh, matchingLayer, removeLayerFeatures]
  )

  const handleDeleteRows = useCallback(
    async () => {
      if (selectedIndices.length === 0) return
      const sortedIndices = [...selectedIndices].sort((a, b) => a - b)
      const rIndices = sortedIndices.map((i) => i + 1).join(',')
      const code = `${accessPath} <- ${accessPath}[-c(${rIndices}), , drop = FALSE]`
      addEntry('input', code)
      addInputHistory(code)
      try {
        const res = await rClient.execute(code)
        if (res.success) {
          if (matchingLayer) removeLayerFeatures(matchingLayer.id, sortedIndices)
          clearSelection(accessPath, envName)
        } else if (res.error) {
          addEntry('error', res.error)
        }
      } catch (err) {
        addEntry('error', String(err))
      } finally {
        setRowHeaderMenu(null)
        refresh()
      }
    },
    [
      selectedIndices, accessPath, envName,
      addEntry, addInputHistory, refresh,
      matchingLayer, removeLayerFeatures, clearSelection,
    ]
  )

  const commitAndMove = useCallback(
    (current: EditingCell, direction: 'up' | 'down' | 'left' | 'right') => {
      handledByKeyRef.current = true
      if (current.value !== current.originalValue) {
        handleCellEdit(current.row, current.col, current.value)
      }
      const next = nextCell(current.row, current.col, totalRows, columns.length, direction)
      if (next) {
        const row = rows.get(next.row)
        const origIdx = colOrder.length > 0 ? colOrder[next.col] : next.col
        const val = editInitialValue(row ? row[origIdx] : '')
        setEditing({ row: next.row, col: next.col, value: val, originalValue: val })
      } else if (direction === 'down' && current.row >= totalRows - 1) {
        if (autoAddRow) {
          handleAddRow(current.col)
        } else {
          setPendingAddRowCol(current.col)
          setAddRowDialogOpen(true)
        }
      } else {
        setEditing(null)
      }
    },
    [handleCellEdit, totalRows, columns.length, colOrder, rows, autoAddRow, handleAddRow]
  )

  const startResize = (e: React.MouseEvent, pos: number) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startWidth = colWidths[pos]
    document.body.style.userSelect = 'none'
    const onMove = (ev: MouseEvent) => {
      setColWidths(prev => {
        const next = [...prev]
        next[pos] = Math.max(MIN_COL_WIDTH, startWidth + (ev.clientX - startX))
        return next
      })
    }
    const onUp = () => {
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const startColReorder = (e: React.MouseEvent, pos: number) => {
    e.preventDefault()
    draggingColRef.current = pos
    setDraggingCol(pos)
    const onMove = (ev: MouseEvent) => {
      if (!headerInnerRef.current) return
      const colEls = headerInnerRef.current.querySelectorAll<HTMLElement>('[data-col-pos]')
      for (const el of colEls) {
        const rect = el.getBoundingClientRect()
        if (ev.clientX >= rect.left && ev.clientX <= rect.right) {
          const p = parseInt(el.dataset.colPos!)
          const side: 'left' | 'right' = ev.clientX < rect.left + rect.width / 2 ? 'left' : 'right'
          dragOverColRef.current = { pos: p, side }
          setDragOverCol({ pos: p, side })
          return
        }
      }
      dragOverColRef.current = null
      setDragOverCol(null)
    }
    const onUp = () => {
      const from = draggingColRef.current
      const over = dragOverColRef.current
      if (from !== null && over !== null && over.pos !== from) {
        const rawInsert = over.side === 'right' ? over.pos + 1 : over.pos
        const insertAt = rawInsert > from ? rawInsert - 1 : rawInsert

        const newOrder = [...colOrder]
        const [item] = newOrder.splice(from, 1)
        newOrder.splice(insertAt, 0, item)
        setColOrder(newOrder)

        setColWidths(prev => {
          const next = [...prev]
          const [w] = next.splice(from, 1)
          next.splice(insertAt, 0, w)
          return next
        })

        // Persist column order to R
        const newColNames = newOrder.map(idx => columns[idx].name)
        const colList = newColNames.map(n => `"${n}"`).join(', ')
        const code = cls === 'data.table'
          ? `data.table::setcolorder(${accessPath}, c(${colList}))`
          : `${accessPath} <- ${accessPath}[, c(${colList})]`
        addEntry('input', code)
        addInputHistory(code)
        rClient.execute(code)
          .then(res => { if (!res.success && res.error) addEntry('error', res.error) })
          .catch(err => addEntry('error', String(err)))
          .finally(() => refresh())
      }
      draggingColRef.current = null
      dragOverColRef.current = null
      setDraggingCol(null)
      setDragOverCol(null)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const startRowReorder = (e: React.MouseEvent, rowIdx: number) => {
    if (e.button !== 0) return
    rowDragStartY.current = e.clientY
    let dragStarted = false

    const onMove = (ev: MouseEvent) => {
      if (!dragStarted) {
        if (Math.abs(ev.clientY - (rowDragStartY.current ?? ev.clientY)) < 5) return
        dragStarted = true
        draggingRowRef.current = rowIdx
        setDraggingRow(rowIdx)
      }
      if (!scrollRef.current) return
      const rect = scrollRef.current.getBoundingClientRect()
      const relY = ev.clientY - rect.top + scrollRef.current.scrollTop
      const targetRowIdx = Math.max(0, Math.min(totalRows - 1, Math.floor(relY / ROW_HEIGHT)))
      const withinRow = relY - targetRowIdx * ROW_HEIGHT
      const side: 'top' | 'bottom' = withinRow < ROW_HEIGHT / 2 ? 'top' : 'bottom'
      dragOverRowRef.current = { rowIdx: targetRowIdx, side }
      setDragOverRow({ rowIdx: targetRowIdx, side })
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)

      const from = draggingRowRef.current
      const over = dragOverRowRef.current
      draggingRowRef.current = null
      dragOverRowRef.current = null
      rowDragStartY.current = null
      setDraggingRow(null)
      setDragOverRow(null)

      if (!dragStarted || from === null || over === null) return

      const rawInsert = over.side === 'bottom' ? over.rowIdx + 1 : over.rowIdx
      const insertAt = rawInsert > from ? rawInsert - 1 : rawInsert
      if (insertAt === from) return

      // R is 1-based; FROM_R is the row being moved; AFTER_R is the insertion point
      // in the post-removal sequence (which equals insertAt)
      const FROM_R = from + 1
      const AFTER_R = insertAt
      const dropFalse = cls === 'data.table' ? '' : ', , drop = FALSE'
      const rowNamesReset = cls === 'data.table' ? '' : `\nrownames(${accessPath}) <- NULL`
      const code =
        `${accessPath} <- ${accessPath}[append(seq_len(nrow(${accessPath}))[- ${FROM_R}L], ${FROM_R}L, after = ${AFTER_R}L)${dropFalse}]${rowNamesReset}`

      addEntry('input', code)
      addInputHistory(code)
      rClient.execute(code)
        .then(res => { if (!res.success && res.error) addEntry('error', res.error) })
        .catch(err => addEntry('error', String(err)))
        .finally(() => refresh())
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const handleColHeaderMouseDown = (e: React.MouseEvent, pos: number) => {
    const now = Date.now()
    const last = lastHeaderClickRef.current
    if (last?.pos === pos && now - last.time < 400) {
      lastHeaderClickRef.current = null
      startColReorder(e, pos)
    } else {
      lastHeaderClickRef.current = { pos, time: now }
    }
  }

  const handleRowClick = useCallback((e: React.MouseEvent, rowIdx: number) => {
    if (!rowSelectMode) return
    const store = useSelectionStore.getState()
    const current = store.selections[selKey] ?? []

    let next: number[]
    if (e.shiftKey && selectionAnchorRef.current !== null) {
      const lo = Math.min(selectionAnchorRef.current, rowIdx)
      const hi = Math.max(selectionAnchorRef.current, rowIdx)
      const range = Array.from({ length: hi - lo + 1 }, (_, k) => lo + k)
      next = Array.from(new Set([...current, ...range]))
    } else if (e.ctrlKey || e.metaKey) {
      const currentSet = new Set(current)
      if (currentSet.has(rowIdx)) {
        next = current.filter((i) => i !== rowIdx)
      } else {
        next = [...current, rowIdx]
        selectionAnchorRef.current = rowIdx
      }
    } else {
      next = [rowIdx]
      selectionAnchorRef.current = rowIdx
    }

    selectionFromClickRef.current = true
    if (next.length === 0) {
      store.clearSelection(accessPath, envName)
      selectionAnchorRef.current = null
    } else {
      store.setSelection(accessPath, envName, next)
    }
  }, [rowSelectMode, accessPath, envName, selKey])

  useEffect(() => {
    if (selectionFromClickRef.current) {
      selectionFromClickRef.current = false
      return
    }
    if (selectedIndices.length === 0 || !scrollRef.current) return
    const firstIdx = selectedIndices[0]
    const rowTop = firstIdx * ROW_HEIGHT
    const { scrollTop, clientHeight } = scrollRef.current
    const isVisible = rowTop >= scrollTop && rowTop < scrollTop + clientHeight - ROW_HEIGHT
    if (!isVisible) {
      scrollRef.current.scrollTop = Math.max(0, rowTop - clientHeight / 2)
    }
  }, [selectedIndices])

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-geo-error gap-2">
        <span className="text-sm">{error}</span>
        <Button variant="ghost" size="sm" onClick={refresh}>
          Retry
        </Button>
      </div>
    )
  }

  // First geometry column (if any) powers the ＋ Add Feature button and cell pencils
  const geomCol = columns.find((c) => isGeomColumn(c.type)) ?? null

  // Anything with geometry can go on the map: an sf object, and equally a
  // database-backed tbl or a plain data.frame carrying an sfc column — the
  // Environment panel only ever offered this for the first kind.
  const isSpatialDataset = geomCol !== null || SF_CLASSES.includes(cls)

  // When showOnlySelected is active, map virtual positions to actual row indices
  const effectiveIndices = (showOnlySelected && hasSelection) ? selectedIndices : null
  const effectiveTotalRows = effectiveIndices ? effectiveIndices.length : totalRows
  const selectedSet = new Set(selectedIndices)

  const getActualRowIdx = (virtualIdx: number): number =>
    effectiveIndices ? effectiveIndices[virtualIdx] : virtualIdx

  const totalHeight = effectiveTotalRows * ROW_HEIGHT
  const startRow = Math.floor(scrollTop / ROW_HEIGHT)
  const viewportHeight = scrollRef.current?.clientHeight || 600
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + 2
  const endRow = Math.min(startRow + visibleCount, effectiveTotalRows)
  const totalWidth = colWidths.length > 0
    ? ROW_NUM_WIDTH + colWidths.reduce((s, w) => s + w, 0) + ADD_BTN_WIDTH
    : undefined

  // Calculate drop indicator left offset
  const getDropLeft = (): number | null => {
    if (!dragOverCol || draggingCol === null) return null
    let left = ROW_NUM_WIDTH
    for (let p = 0; p < colWidths.length; p++) {
      if (p === dragOverCol.pos) return dragOverCol.side === 'left' ? left : left + colWidths[p]
      left += colWidths[p]
    }
    return null
  }
  const dropLeft = getDropLeft()

  const headerSummary =
    `${name} — ${cls === 'tbl_dbi' ? 'database tbl (lazy)' : cls} — ${totalRows} x ${columns.length}`

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-geo-border flex-shrink-0">
        {/* Truncated in a narrow pane, and the dataset's name is the first
            thing to go — so the whole line is also the hover title. */}
        <span
          className="text-xs text-geo-muted flex items-center gap-1.5 min-w-0 truncate"
          title={headerSummary}
        >
          {cls === 'tbl_dbi' && (
            <Database className="w-3 h-3 text-geo-accent" />
          )}
          {headerSummary}
        </span>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Button variant="ghost" size="sm" className="h-6 text-xs" data-ourgeo-id="dataViewer.dataChecks" aria-expanded={showDataChecks} onClick={() => setShowDataChecks(v => !v)}>Data checks</Button>
          {isSpatialDataset && <Button variant="ghost" size="sm" className="h-6 text-xs" data-ourgeo-id="dataViewer.exportVector" onClick={() => setShowVectorExport(true)}>Export layer…</Button>}
          {hasSelection && (
            <span className="text-xs text-geo-accent flex items-center gap-1 mr-1">
              {selectedIndices.length} selected
              <button
                className="text-geo-muted hover:text-foreground leading-none"
                title="Clear selection"
                onClick={() => { useSelectionStore.getState().clearSelection(accessPath, envName); setShowOnlySelected(false) }}
              >×</button>
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className={`h-6 w-6 p-0 ${rowSelectMode ? 'text-geo-accent bg-geo-accent/10' : 'text-geo-muted hover:text-foreground'}`}
            title={rowSelectMode ? 'Row selection active — click to deactivate' : 'Select rows'}
            onClick={() => setRowSelectMode((v) => !v)}
          >
            <MousePointer2 className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-geo-muted hover:text-foreground"
            title="Select by query"
            onClick={() => setQueryDialogOpen(true)}
          >
            <Filter className="w-3 h-3" />
          </Button>
          {hasSelection && (
            <Button
              variant="ghost"
              size="sm"
              className={`h-6 w-6 p-0 ${showOnlySelected ? 'text-geo-accent' : 'text-geo-muted hover:text-foreground'}`}
              title={showOnlySelected ? 'Show all rows' : 'Show only selected'}
              onClick={() => setShowOnlySelected((v) => !v)}
            >
              <ListFilter className="w-3 h-3" />
            </Button>
          )}
          {matchingLayer && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-geo-muted hover:text-foreground disabled:opacity-40"
                title={hasSelection ? 'Zoom to selected rows' : 'Zoom to selected rows (select rows first)'}
                disabled={!hasSelection}
                onClick={() => zoomToRows(selectedIndices)}
              >
                <Locate className="w-3 h-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-geo-muted hover:text-foreground"
                title="Zoom to layer extent"
                onClick={zoomToLayerExtent}
              >
                <Maximize2 className="w-3 h-3" />
              </Button>
            </>
          )}
          {isSpatialDataset && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs gap-1 text-geo-muted hover:text-foreground"
              title="Add this dataset to the spatial editor as a layer"
              data-ourgeo-id="dataViewer.addToMap"
              onClick={handleSendToMap}
            >
              <MapIcon className="w-3 h-3" />
              Add to Map
            </Button>
          )}
          {geomCol && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs gap-1 text-geo-accent hover:text-geo-accent hover:bg-geo-accent/10"
              title="Add a new row and draw its geometry in the spatial editor"
              onClick={(e) => handleAddFeature(e, geomCol)}
            >
              <Plus className="w-3 h-3" />
              Add Feature
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs gap-1"
            onClick={refresh}
            disabled={loading}
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {showDataChecks && <div className="max-h-[55%] overflow-auto p-2 flex-shrink-0"><DataChecksPanel request={{ operationType: 'inspect', inputs: [{ name, envName, accessPath, ...(selectedIndices.length ? { rows: selectedIndices } : {}) }], parameters: {} }} /></div>}
      {showVectorExport && <VectorExportDialog name={name} envName={envName} accessPath={accessPath} fields={columns.filter(c => c.name !== geomCol?.name).map(c => c.name)} onClose={() => setShowVectorExport(false)} />}

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className="h-full flex flex-col">
          {/* Column headers — overflow hidden, translated to sync with horizontal scroll */}
          <div className="border-b border-geo-border flex-shrink-0 bg-geo-bg overflow-hidden relative">
            <div ref={headerInnerRef} style={{ display: 'flex', width: totalWidth }}>
              <div
                style={{ width: ROW_NUM_WIDTH, flexShrink: 0 }}
                className="px-2 py-1 text-[10px] text-geo-muted border-r border-geo-border"
              >
                #
              </div>
              {colOrder.map((origIdx, pos) => {
                const col = columns[origIdx]
                if (!col) return null
                const w = colWidths[pos] ?? 120
                const isDragging = draggingCol === pos
                const isDropTarget = dragOverCol?.pos === pos
                return (
                  <div
                    key={origIdx}
                    data-col-pos={pos}
                    style={{ width: w, flexShrink: 0, position: 'relative' }}
                    className={`px-2 py-1 border-r border-geo-border select-none${isDragging ? ' opacity-40' : ''}`}
                    onMouseDown={(e) => handleColHeaderMouseDown(e, pos)}
                  >
                    {isDropTarget && dropLeft !== null && (
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-geo-accent z-20 pointer-events-none"
                        style={{ left: dragOverCol!.side === 'left' ? 0 : w - 2 }}
                      />
                    )}
                    {renamingCol?.name === col.name ? (
                      <input
                        autoFocus
                        className="w-full bg-geo-bg border border-geo-accent rounded px-1 text-xs text-foreground outline-none"
                        style={{ height: '16px' }}
                        value={renamingCol.draft}
                        onChange={(e) => setRenamingCol({ name: col.name, draft: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            handleRenameColumn(col.name, renamingCol.draft)
                          } else if (e.key === 'Escape') {
                            e.preventDefault()
                            cancelRenameRef.current = true
                            setRenamingCol(null)
                          }
                        }}
                        onBlur={() => {
                          if (cancelRenameRef.current) {
                            cancelRenameRef.current = false
                            return
                          }
                          handleRenameColumn(col.name, renamingCol.draft)
                        }}
                      />
                    ) : (
                      <div
                        className="text-xs text-foreground truncate cursor-grab"
                        onDoubleClick={(e) => {
                          e.stopPropagation()
                          setRenamingCol({ name: col.name, draft: col.name })
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          setColHeaderMenu({ x: e.clientX, y: e.clientY, colName: col.name })
                        }}
                        title="Double-click to rename; double-click+hold to reorder; right-click for options"
                      >
                        {col.name}
                      </div>
                    )}
                    <ColumnTypeDropdown
                      currentType={col.type}
                      onTypeChange={(newType) => handleTypeChange(col.name, newType)}
                    />
                    {/* Resize handle */}
                    <div
                      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-geo-accent/50 z-10"
                      onMouseDown={(e) => startResize(e, pos)}
                    />
                  </div>
                )
              })}
              <button
                onClick={() => setAddColOpen(true)}
                style={{ width: ADD_BTN_WIDTH, flexShrink: 0 }}
                className="flex items-center justify-center text-geo-muted hover:text-geo-accent hover:bg-geo-panel border-r border-geo-border text-sm"
                title="Add column"
              >+</button>
            </div>
          </div>

          {/* Scrollable rows */}
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto" onScroll={handleScroll}>
            <div style={{ height: totalHeight, position: 'relative', width: totalWidth }}>
              {Array.from({ length: endRow - startRow }, (_, i) => {
                const virtualIdx = startRow + i
                const rowIdx = getActualRowIdx(virtualIdx)
                const row = rows.get(rowIdx)
                const top = virtualIdx * ROW_HEIGHT
                const isSelected = selectedSet.has(rowIdx)

                return (
                  <div
                    key={rowIdx}
                    className={`flex absolute border-b border-geo-border/30 group/row ${isSelected ? 'bg-geo-accent/10' : 'hover:bg-geo-bg/30'} ${rowSelectMode ? 'cursor-pointer' : ''}`}
                    style={{ top, height: ROW_HEIGHT, width: totalWidth }}
                    onClick={(e) => handleRowClick(e, rowIdx)}
                  >
                    <div
                      style={{ width: ROW_NUM_WIDTH, flexShrink: 0 }}
                      className={`px-2 flex items-center text-[10px] border-r border-geo-border select-none ${rowSelectMode ? 'cursor-pointer' : 'cursor-grab'} ${draggingRow === rowIdx ? 'opacity-40' : ''} ${isSelected ? 'text-geo-accent font-medium' : 'text-geo-muted'}`}
                      onMouseDown={(e) => startRowReorder(e, rowIdx)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setRowHeaderMenu({ x: e.clientX, y: e.clientY, rowIdx })
                      }}
                    >
                      {rowIdx + 1}
                    </div>
                    {colOrder.map((origIdx, pos) => {
                      const col = columns[origIdx]
                      if (!col) return null
                      const w = colWidths[pos] ?? 120
                      const value = row ? row[origIdx] ?? '' : ''
                      const isEditing = editing?.row === rowIdx && editing?.col === pos
                      const isNA = value === 'NA'
                      const isActiveGeomCell =
                        geoSession?.accessPath === accessPath &&
                        geoSession?.envName === envName &&
                        geoSession?.columnName === col.name &&
                        geoSession?.currentRow === rowIdx

                      return (
                        <div
                          key={origIdx}
                          style={{ width: w, flexShrink: 0 }}
                          className={`px-2 flex items-center border-r border-geo-border/30 text-xs cursor-text overflow-hidden${isActiveGeomCell ? ' ring-2 ring-inset ring-geo-accent' : ''}`}
                          onClick={() => {
                            if (!isEditing && row && !isGeomColumn(col.type)) {
                              const init = editInitialValue(value)
                              setEditing({ row: rowIdx, col: pos, value: init, originalValue: init })
                            }
                          }}
                          onContextMenu={(e) => {
                            if (!isGeomColumn(col.type)) return
                            e.preventDefault()
                            setContextMenu({ x: e.clientX, y: e.clientY, rowIdx, col })
                          }}
                        >
                          {isEditing ? (
                            <input
                              autoFocus
                              className="w-full bg-geo-bg border border-geo-accent rounded px-1 py-0.5 text-xs text-foreground outline-none"
                              value={editing.value}
                              onChange={(e) =>
                                setEditing({ ...editing, value: e.target.value })
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  commitAndMove(editing, 'down')
                                } else if (e.key === 'Tab') {
                                  e.preventDefault()
                                  commitAndMove(editing, e.shiftKey ? 'left' : 'right')
                                } else if (e.key === 'ArrowDown') {
                                  e.preventDefault()
                                  commitAndMove(editing, 'down')
                                } else if (e.key === 'ArrowUp') {
                                  e.preventDefault()
                                  commitAndMove(editing, 'up')
                                } else if (e.key === 'Escape') {
                                  handledByKeyRef.current = true
                                  setEditing(null)
                                }
                              }}
                              onBlur={() => {
                                if (handledByKeyRef.current) {
                                  handledByKeyRef.current = false
                                  return
                                }
                                if (editing && editing.value !== editing.originalValue) {
                                  handleCellEdit(editing.row, editing.col, editing.value)
                                }
                                setEditing(null)
                              }}
                            />
                          ) : (
                            <>
                              <span
                                className={`truncate ${isNA ? 'text-geo-muted italic' : 'text-foreground'}`}
                              >
                                {row ? value : ''}
                              </span>
                              {isGeomColumn(col.type) && row && (
                                <button
                                  className="ml-auto pl-1 flex-shrink-0 opacity-0 group-hover/row:opacity-100 text-geo-muted hover:text-geo-accent"
                                  title={isNA ? 'Draw geometry for this row' : 'Redraw geometry for this row'}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    if (getGeomType(col.type)) startDrawGeometry(rowIdx, col)
                                    else setContextMenu({ x: e.clientX, y: e.clientY, rowIdx, col })
                                  }}
                                >
                                  <Pencil className="w-3 h-3" />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
              {draggingRow !== null && dragOverRow !== null && (() => {
                const indicatorRow = dragOverRow.side === 'top' ? dragOverRow.rowIdx : dragOverRow.rowIdx + 1
                const top = indicatorRow * ROW_HEIGHT - 1
                return (
                  <div
                    key="row-drop-indicator"
                    className="absolute left-0 h-0.5 bg-geo-accent z-20 pointer-events-none"
                    style={{ top, width: totalWidth }}
                  />
                )
              })()}
            </div>
          </div>
        </div>
      </div>

      <Dialog.Root
        open={addRowDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setAddRowDialogOpen(false)
            setEditing(null)
            refresh()
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[320px] bg-geo-panel border border-geo-border rounded-lg shadow-xl p-4 flex flex-col gap-4">
            <Dialog.Title className="text-sm font-semibold text-foreground">Add New Row?</Dialog.Title>
            <Dialog.Description className="text-xs text-geo-muted">
              You've reached the end of the table. Add a new empty row?
            </Dialog.Description>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs text-geo-muted hover:text-foreground"
                onClick={() => {
                  setAddRowDialogOpen(false)
                  setEditing(null)
                  refresh()
                }}
              >
                No
              </Button>
              <Button
                size="sm"
                className="h-6 text-xs bg-geo-accent hover:bg-geo-accent/80 text-white"
                onClick={() => handleAddRow(pendingAddRowCol)}
              >
                Yes
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <AddColumnDialog
        open={addColOpen}
        onOpenChange={setAddColOpen}
        mode="dataframe"
        dfClass={cls}
        accessPath={accessPath}
        onConfirm={handleAddColumn}
        columns={colOrder.map(i => columns[i]?.name).filter(Boolean) as string[]}
      />
      {contextMenu && (() => {
        const { x, y, rowIdx, col } = contextMenu
        const geomType = getGeomType(col.type)
        const items = geomType
          ? [{
              label: 'Draw Geometry',
              onClick: () => startDrawGeometry(rowIdx, col)
            }]
          : [{
              label: 'Draw Geometry',
              submenu: GEOM_TYPES.map((gt) => ({
                label: gt.charAt(0) + gt.slice(1).toLowerCase(),
                onClick: () => startDrawGeometry(rowIdx, col, gt)
              }))
            }]
        return (
          <ContextMenu
            x={x}
            y={y}
            items={items}
            onClose={() => setContextMenu(null)}
          />
        )
      })()}
      {addFeatureMenu && (
        <ContextMenu
          x={addFeatureMenu.x}
          y={addFeatureMenu.y}
          items={GEOM_TYPES.map((gt) => ({
            label: gt.charAt(0) + gt.slice(1).toLowerCase(),
            onClick: () => {
              void addFeatureAndDraw({
                accessPath,
                envName,
                columnName: addFeatureMenu.col.name,
                colLib: addFeatureMenu.col.type.startsWith('sfc_') ? 'sf' : 'geos',
                geometryType: gt,
                totalRows
              })
            }
          }))}
          onClose={() => setAddFeatureMenu(null)}
        />
      )}
      {colHeaderMenu && (
        <ContextMenu
          x={colHeaderMenu.x}
          y={colHeaderMenu.y}
          items={[{ label: 'Delete Column', onClick: () => handleDeleteColumn(colHeaderMenu.colName) }]}
          onClose={() => setColHeaderMenu(null)}
        />
      )}
      {rowHeaderMenu && (
        <ContextMenu
          x={rowHeaderMenu.x}
          y={rowHeaderMenu.y}
          items={[
            ...(matchingLayer ? [{ label: 'Zoom to this row', onClick: () => zoomToRows([rowHeaderMenu.rowIdx]) }] : []),
            { label: 'Delete Row', onClick: () => handleDeleteRow(rowHeaderMenu.rowIdx) },
            ...(hasSelection ? [{ label: `Delete Rows (${selectedIndices.length})`, onClick: handleDeleteRows }] : []),
          ]}
          onClose={() => setRowHeaderMenu(null)}
        />
      )}
      <AlreadyOnMapDialog
        name={alreadyOnMap.length > 0 ? accessPath : null}
        count={alreadyOnMap.length}
        onCancel={() => setAlreadyOnMap([])}
        onShowExisting={() => { focusMapLayer(alreadyOnMap[0].id); setAlreadyOnMap([]) }}
        onAddAgain={() => { setAlreadyOnMap([]); void sendToMap() }}
      />
      <SelectionQueryDialog
        open={queryDialogOpen}
        onClose={() => setQueryDialogOpen(false)}
        accessPath={accessPath}
        envName={envName}
        cls={cls}
      />
    </div>
  )
}
