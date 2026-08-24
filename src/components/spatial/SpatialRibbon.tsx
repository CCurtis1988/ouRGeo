import React, { useState, useRef, useEffect } from 'react'
import { Plus, Lasso, MousePointer2, Check, Eye, EyeOff, Trash2, Pencil, ChevronDown, GripVertical, Settings2, Type, Map } from 'lucide-react'
import { Button } from '../ui/button'
import { useSpatialStore } from '@/store/spatial'
import { useGeometryEditStore, selectActiveSessionLayerIds, selectActiveSession } from '@/store/geometryEdit'
import { useSelectionStore } from '@/store/selection'
import { usePendingEditGroups } from '@/hooks/useSaveEdits'
import { SaveEditsDialog } from './SaveEditsDialog'
import { SessionManagerDropdown } from './SessionManagerDropdown'
import { SymbologyDialog } from './SymbologyDialog'
import { RasterSymbologyDialog } from './RasterSymbologyDialog'
import { LabelingDialog } from './LabelingDialog'
import { LegendSettingsDialog } from './LegendSettingsDialog'
import { NorthArrowSettingsDialog } from './NorthArrowSettingsDialog'
import { BasemapDialog } from './BasemapDialog'
import { ExportDropdown } from './ExportDropdown'
import { LayerPreview } from './LayerPreview'
import { rClient } from '@/lib/r-client'
import { cn } from '@/lib/utils'

interface SpatialRibbonProps {
  onFitBounds: () => void
  mapContainerRef: React.RefObject<HTMLDivElement>
}

function SettingsToggle({
  label,
  checked,
  onChange,
  onSettingsClick,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  onSettingsClick: () => void
}): React.ReactElement {
  return (
    <div className="flex items-center w-full px-3 py-1 hover:bg-geo-bg group">
      <button
        className="flex items-center gap-2 flex-1 text-xs text-foreground"
        onClick={() => onChange(!checked)}
      >
        <div
          className={cn(
            'w-3 h-3 rounded-sm border flex-shrink-0 flex items-center justify-center',
            checked
              ? 'bg-geo-accent border-geo-accent'
              : 'border-geo-muted bg-transparent'
          )}
        >
          {checked && (
            <svg viewBox="0 0 10 10" className="w-2 h-2" fill="none">
              <polyline points="1.5,5 4,7.5 8.5,2.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
        {label}
      </button>
      <button
        className="opacity-0 group-hover:opacity-100 p-0.5 text-geo-muted hover:text-foreground rounded transition-opacity"
        onClick={(e) => { e.stopPropagation(); onSettingsClick() }}
        title={`${label} settings`}
      >
        <Settings2 className="w-3 h-3" />
      </button>
    </div>
  )
}

export function SpatialRibbon({ onFitBounds, mapContainerRef }: SpatialRibbonProps): React.ReactElement {
  const allLayers = useSpatialStore((s) => s.layers)
  const setDialogOpen = useSpatialStore((s) => s.setAddFeaturesDialogOpen)
  const toggleVisibility = useSpatialStore((s) => s.toggleLayerVisibility)
  const removeSpatialLayer = useSpatialStore((s) => s.removeLayer)
  const reorderLayers = useSpatialStore((s) => s.reorderLayers)
  const selectedLayerId = useSpatialStore((s) => s.selectedLayerId)
  const setSelectedLayerId = useSpatialStore((s) => s.setSelectedLayerId)
  const pendingGroups = usePendingEditGroups()
  const pendingCount = pendingGroups.reduce((n, g) => n + g.geometryCount + g.rowAddCount, 0)
  const [saveEditsOpen, setSaveEditsOpen] = useState(false)
  const isEditMode = useGeometryEditStore((s) => s.isEditMode)
  const namedSessions = useGeometryEditStore((s) => s.namedSessions)
  const setEditMode = useGeometryEditStore((s) => s.setEditMode)
  const setActiveTool = useGeometryEditStore((s) => s.setActiveTool)
  const sessionLayerIds = useGeometryEditStore(selectActiveSessionLayerIds)
  const activeSession = useGeometryEditStore(selectActiveSession)
  const removeLayerFromActiveSession = useGeometryEditStore((s) => s.removeLayerFromActiveSession)

  // Show all layers when actively drawing (activeSession != null) so the user can
  // see and manage their existing layers while drawing new geometry.
  // Only filter to session-owned layers when in edit mode with no active draw.
  const layers = (sessionLayerIds === null || activeSession !== null)
    ? allLayers
    : allLayers.filter((l) => sessionLayerIds.includes(l.id))

  const handleRemoveLayer = (layerId: string) => {
    // Raster layers: free the server-side warp/tile cache, then drop the
    // layer — they never participate in edit sessions or pending edits.
    const target = useSpatialStore.getState().layers.find((l) => l.id === layerId)
    if (target?.kind === 'raster') {
      if (target.raster) {
        rClient.rasterUnregister(target.raster.layerId).catch(() => {})
      }
      removeSpatialLayer(layerId)
      return
    }

    // Warn before discarding unsaved DB-layer edits — silent loss is the
    // bug we're fixing, not a feature.
    const pending = useSpatialStore.getState().pendingGeometryEdits[layerId]
    if (pending?.length) {
      const ok = window.confirm(
        `This layer has ${pending.length} unsaved geometry edit(s). ` +
        `Removing it will discard them. Click OK to discard and remove, ` +
        `or Cancel to keep the layer (use Save first to persist edits).`
      )
      if (!ok) return
      useSpatialStore.getState().discardPendingGeometryEdits(layerId)
    }
    if (!isEditMode) {
      removeSpatialLayer(layerId)
      return
    }
    const orphaned = removeLayerFromActiveSession(layerId)
    if (orphaned) removeSpatialLayer(layerId)
  }

  const dragLayerId = useRef<string | null>(null)
  const dragOverLayerId = useRef<string | null>(null)

  const handleLayerDragStart = (e: React.MouseEvent, layerId: string) => {
    e.preventDefault()
    e.stopPropagation()
    dragLayerId.current = layerId

    const onMouseMove = (ev: MouseEvent) => {
      const target = document.elementFromPoint(ev.clientX, ev.clientY)
      const row = target?.closest('[data-layer-id]') as HTMLElement | null
      if (row) dragOverLayerId.current = row.dataset.layerId ?? null
    }

    const onMouseUp = () => {
      if (dragLayerId.current && dragOverLayerId.current &&
          dragLayerId.current !== dragOverLayerId.current) {
        const ids = layers.map((l) => l.id)
        const from = ids.indexOf(dragLayerId.current)
        const to = ids.indexOf(dragOverLayerId.current)
        if (from !== -1 && to !== -1) {
          ids.splice(from, 1)
          ids.splice(to, 0, dragLayerId.current)
          reorderLayers(ids)
        }
      }
      dragLayerId.current = null
      dragOverLayerId.current = null
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  const showSessionManager = isEditMode || namedSessions.length > 0

  const showLegend = useSpatialStore((s) => s.showLegend)
  const showNorthArrow = useSpatialStore((s) => s.showNorthArrow)
  const setShowLegend = useSpatialStore((s) => s.setShowLegend)
  const setShowNorthArrow = useSpatialStore((s) => s.setShowNorthArrow)
  const selectMode = useSelectionStore((s) => s.selectMode)
  const isSelectActive = useSelectionStore((s) => s.isSelectActive)
  const toggleSelectTool = useSelectionStore((s) => s.toggleSelectTool)
  const setSelectMode = useSelectionStore((s) => s.setSelectMode)
  const setSelectToolActive = useSelectionStore((s) => s.setSelectToolActive)

  const [contentsOpen, setContentsOpen] = useState(false)
  const contentsRef = useRef<HTMLDivElement>(null)
  const [selectOpen, setSelectOpen] = useState(false)
  const selectRef = useRef<HTMLDivElement>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)
  const [symbologyLayerId, setSymbologyLayerId] = useState<string | null>(null)
  const [labelLayerId, setLabelLayerId] = useState<string | null>(null)
  const [legendSettingsOpen, setLegendSettingsOpen] = useState(false)
  const [northArrowSettingsOpen, setNorthArrowSettingsOpen] = useState(false)
  const [basemapDialogOpen, setBasemapDialogOpen] = useState(false)

  useEffect(() => {
    if (!contentsOpen) return
    function onPointerDown(e: PointerEvent) {
      if (contentsRef.current && !contentsRef.current.contains(e.target as Node))
        setContentsOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setContentsOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [contentsOpen])

  useEffect(() => {
    if (!settingsOpen) return
    function onPointerDown(e: PointerEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node))
        setSettingsOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setSettingsOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [settingsOpen])

  useEffect(() => {
    if (!selectOpen) return
    function onPointerDown(e: PointerEvent) {
      if (selectRef.current && !selectRef.current.contains(e.target as Node))
        setSelectOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setSelectOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [selectOpen])

  const selectModeLabel = selectMode === 'point' ? 'Point Select' : 'Lasso Select'
  const SelectModeIcon = selectMode === 'point' ? MousePointer2 : Lasso

  return (
    <div className="flex items-center h-9 border-b border-geo-border flex-shrink-0 min-w-0">
      {/* Left controls */}
      <div className="flex items-center gap-1 px-2 flex-1 min-w-0">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-geo-muted hover:text-foreground flex-shrink-0"
          onClick={() => setDialogOpen(true)}
          title="Add Features"
        >
          <Plus className="w-3.5 h-3.5" />
        </Button>
        <div className="relative flex-shrink-0" ref={selectRef}>
          <div className="flex items-center">
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-6 w-6 p-0',
                isSelectActive
                  ? 'text-geo-accent bg-geo-accent/10'
                  : 'text-geo-muted hover:text-foreground'
              )}
              onClick={toggleSelectTool}
              title={
                isSelectActive
                  ? `${selectModeLabel} (active — click to deactivate)`
                  : selectModeLabel
              }
            >
              <SelectModeIcon className="w-3.5 h-3.5" />
            </Button>
            <button
              className={cn(
                'h-6 w-3 flex items-center justify-center rounded-r',
                selectOpen ? 'text-foreground' : 'text-geo-muted hover:text-foreground'
              )}
              onClick={() => setSelectOpen((o) => !o)}
              title="Selection mode"
            >
              <ChevronDown className={cn('w-3 h-3 transition-transform', selectOpen && 'rotate-180')} />
            </button>
          </div>
          {selectOpen && (
            <div className="absolute left-0 top-full mt-1 w-36 bg-geo-panel border border-geo-border rounded shadow-lg z-50 py-1">
              {([
                { mode: 'point' as const, label: 'Point Select', Icon: MousePointer2 },
                { mode: 'lasso' as const, label: 'Lasso Select', Icon: Lasso },
              ]).map(({ mode, label, Icon }) => (
                <button
                  key={mode}
                  className="flex items-center gap-2 w-full px-3 py-1 text-xs text-foreground hover:bg-geo-bg"
                  onClick={() => {
                    setSelectMode(mode)
                    setSelectToolActive(true)
                    setSelectOpen(false)
                  }}
                >
                  <Icon className="w-3 h-3 text-geo-muted" />
                  <span className="flex-1 text-left">{label}</span>
                  {selectMode === mode && <Check className="w-3 h-3 text-geo-accent" />}
                </button>
              ))}
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-geo-muted hover:text-foreground flex-shrink-0"
          onClick={() => setBasemapDialogOpen(true)}
          title="Change basemap"
        >
          <Map className="w-3.5 h-3.5" />
        </Button>

        {layers.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'h-6 px-2 text-xs flex-shrink-0 gap-1',
              isEditMode ? 'text-geo-accent' : 'text-geo-muted hover:text-foreground'
            )}
            onClick={() => {
              if (!isEditMode) {
                setEditMode(true)
                setActiveTool('select')
              } else {
                setEditMode(false)
              }
            }}
            title={isEditMode ? 'Exit Edit Mode' : 'Enter Edit Mode'}
          >
            <Pencil className="w-3 h-3" />
            {isEditMode ? 'Editing' : 'Edit'}
          </Button>
        )}

        {pendingCount > 0 && (
          <>
            <div className="w-px h-4 bg-geo-border flex-shrink-0 mx-1" />
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs flex-shrink-0 text-geo-success hover:text-geo-success hover:bg-geo-success/10"
              onClick={() => setSaveEditsOpen(true)}
              title={`Unsaved edits: ${pendingGroups
                .map((g) => `${g.displayName} (${g.geometryCount + g.rowAddCount})`)
                .join(', ')} — click to save or discard per object`}
            >
              Save Edits ({pendingCount})
            </Button>
          </>
        )}

        {layers.length > 0 && <div className="w-px h-4 bg-geo-border flex-shrink-0 mx-1" />}

        {/* Contents dropdown */}
        {layers.length > 0 && (
          <div className="relative flex-shrink-0" ref={contentsRef}>
            <button
              className={cn(
                'flex items-center gap-1 px-2 py-1 text-xs rounded border',
                contentsOpen
                  ? 'bg-geo-bg border-geo-border text-foreground'
                  : 'border-geo-border text-geo-muted hover:text-foreground hover:bg-geo-bg'
              )}
              onClick={() => setContentsOpen((v) => !v)}
              title="Contents"
            >
              <span>
                Contents{layers.length > 0 ? ` (${layers.length})` : ''}
              </span>
              <ChevronDown
                className={cn('w-3 h-3 flex-shrink-0 transition-transform', contentsOpen ? 'rotate-180' : '')}
              />
            </button>

            {contentsOpen && (
              <div className="absolute left-0 top-full mt-1 w-64 bg-geo-panel border border-geo-border rounded shadow-lg z-50">
                {layers.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-geo-muted">No layers</div>
                ) : (
                  <ul className="flex flex-col max-h-64 overflow-y-auto py-1">
                    {layers.map((layer) => (
                      <li
                        key={layer.id}
                        data-layer-id={layer.id}
                        onClick={() => setSelectedLayerId(layer.id)}
                        className={cn(
                          'flex items-center gap-2 px-2 py-1.5 hover:bg-geo-bg group cursor-pointer',
                          selectedLayerId === layer.id && 'bg-geo-bg/60'
                        )}
                      >
                        <LayerPreview
                          layer={layer}
                          onClick={(e) => {
                            e.stopPropagation()
                            setSymbologyLayerId(layer.id)
                            setContentsOpen(false)
                          }}
                        />
                        <span
                          className={cn(
                            'flex-1 min-w-0 truncate text-xs',
                            layer.visible ? 'text-foreground' : 'text-geo-muted'
                          )}
                        >
                          {layer.name}
                        </span>
                        {(() => {
                          const g = pendingGroups.find((pg) => pg.key === layer.id)
                          const n = g ? g.geometryCount + g.rowAddCount : 0
                          return n > 0 ? (
                            <span
                              className="flex-shrink-0 text-[9px] px-1 rounded bg-geo-success/15 text-geo-success border border-geo-success/40"
                              title={`${n} unsaved edit${n === 1 ? '' : 's'} — use Save Edits`}
                            >
                              {n}
                            </span>
                          ) : null
                        })()}
                        {layer.kind !== 'raster' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className={cn(
                              'h-5 w-5 p-0 flex-shrink-0',
                              layer.labelSettings?.enabled
                                ? 'text-geo-accent'
                                : 'text-geo-muted hover:text-foreground'
                            )}
                            onClick={(e) => {
                              e.stopPropagation()
                              setLabelLayerId(layer.id)
                              setContentsOpen(false)
                            }}
                            title="Label settings"
                          >
                            <Type className="w-3 h-3" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 p-0 text-geo-muted hover:text-foreground flex-shrink-0"
                          onClick={() => toggleVisibility(layer.id)}
                          title={layer.visible ? 'Hide' : 'Show'}
                        >
                          {layer.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 p-0 text-geo-muted hover:text-geo-error flex-shrink-0"
                          onClick={() => handleRemoveLayer(layer.id)}
                          title="Remove"
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                        <div
                          className="h-5 w-5 flex items-center justify-center text-geo-muted hover:text-foreground cursor-grab flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          onMouseDown={(e) => handleLayerDragStart(e, layer.id)}
                          title="Drag to reorder"
                        >
                          <GripVertical className="w-3 h-3" />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
        {/* Export dropdown */}
        <ExportDropdown mapContainerRef={mapContainerRef} />

        {/* Settings dropdown */}
        <div className="relative flex-shrink-0" ref={settingsRef}>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'h-6 w-6 p-0 flex-shrink-0',
              settingsOpen ? 'text-foreground' : 'text-geo-muted hover:text-foreground'
            )}
            onClick={() => setSettingsOpen((v) => !v)}
            title="Map Settings"
          >
            <Settings2 className="w-3.5 h-3.5" />
          </Button>

          {settingsOpen && (
            <div className="absolute left-0 top-full mt-1 w-44 bg-geo-panel border border-geo-border rounded shadow-lg z-50 py-1">
              <SettingsToggle
                label="Legend"
                checked={showLegend}
                onChange={setShowLegend}
                onSettingsClick={() => { setSettingsOpen(false); setLegendSettingsOpen(true) }}
              />
              <SettingsToggle
                label="North Arrow"
                checked={showNorthArrow}
                onChange={setShowNorthArrow}
                onSettingsClick={() => { setSettingsOpen(false); setNorthArrowSettingsOpen(true) }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Pinned right section: session manager */}
      {showSessionManager && (
        <div className="flex-shrink-0 flex items-center px-2 border-l border-geo-border h-full">
          <SessionManagerDropdown />
        </div>
      )}

      <SymbologyDialog
        layerId={
          symbologyLayerId !== null &&
          allLayers.find((l) => l.id === symbologyLayerId)?.kind !== 'raster'
            ? symbologyLayerId
            : null
        }
        onClose={() => setSymbologyLayerId(null)}
      />
      <RasterSymbologyDialog
        layerId={
          symbologyLayerId !== null &&
          allLayers.find((l) => l.id === symbologyLayerId)?.kind === 'raster'
            ? symbologyLayerId
            : null
        }
        onClose={() => setSymbologyLayerId(null)}
      />
      <LabelingDialog
        layerId={labelLayerId}
        onClose={() => setLabelLayerId(null)}
      />
      <LegendSettingsDialog
        open={legendSettingsOpen}
        onClose={() => setLegendSettingsOpen(false)}
      />
      <NorthArrowSettingsDialog
        open={northArrowSettingsOpen}
        onClose={() => setNorthArrowSettingsOpen(false)}
      />
      <BasemapDialog
        open={basemapDialogOpen}
        onClose={() => setBasemapDialogOpen(false)}
      />
      <SaveEditsDialog open={saveEditsOpen} onOpenChange={setSaveEditsOpen} />
    </div>
  )
}
