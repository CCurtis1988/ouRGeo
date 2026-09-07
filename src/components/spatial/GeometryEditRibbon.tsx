import React, { useState, useRef, useEffect } from 'react'
import {
  MousePointer2,
  Pencil,
  Move,
  MapPin,
  Undo2,
  Redo2,
  Check,
  X,
  Magnet,
  Plus,
  Circle,
  Maximize,
  ChevronDown,
  Square,
  Spline,
  Route,
  FlipHorizontal2,
  Minus,
  Radius,
  Waypoints,
  PenTool
} from 'lucide-react'
import { useGeometryEditStore, selectActiveSession } from '@/store/geometryEdit'
import type { ToolId, CurveMode } from '@/store/geometryEdit'
import { useDrawActions } from '@/hooks/useDrawActions'
import { useAddFeature } from '@/hooks/useAddFeature'
import { useSpatialStore } from '@/store/spatial'
import { useSpatialSettingsStore } from '@/store/spatialSettings'
import type { SnapSettings } from '@/store/spatialSettings'
import { saveSpatialSettings } from '@/lib/spatial-settings-persistence'
import { canComplete, canStartNextPart, canStartHole, getPath } from '@/lib/draw/draft'
import { parseCadInput } from '@/lib/draw/cogo'
import { RibbonButton, RibbonDivider as Divider } from '../ui/ribbon'


// ── Unified tool catalog ────────────────────────────────────────────────────
// Every mutually-exclusive editing mode. Icons/labels/hotkeys match the legacy
// flat toolBtn row; switching still funnels through setActiveTool(id), so this
// is presentation only — no store changes, and the hotkeys (useDrawHotkeys)
// keep working independently.
interface ToolDef {
  id: ToolId
  label: string
  icon: React.ReactNode
  hotkey: string
}

const TOOL_DEFS: Record<ToolId, ToolDef> = {
  select: { id: 'select', label: 'Select', icon: <MousePointer2 className="w-3 h-3" />, hotkey: 'S' },
  draw: { id: 'draw', label: 'Draw', icon: <Pencil className="w-3 h-3" />, hotkey: 'D' },
  rectangle: { id: 'rectangle', label: 'Rectangle', icon: <Square className="w-3 h-3" />, hotkey: 'R' },
  circle: { id: 'circle', label: 'Circle', icon: <Circle className="w-3 h-3" />, hotkey: 'C' },
  freehand: { id: 'freehand', label: 'Freehand', icon: <Spline className="w-3 h-3" />, hotkey: 'F' },
  trace: { id: 'trace', label: 'Trace', icon: <Route className="w-3 h-3" />, hotkey: 'T · Tab flips direction' },
  'offset-trace': { id: 'offset-trace', label: 'Offset', icon: <FlipHorizontal2 className="w-3 h-3" />, hotkey: 'O · Tab flips direction' },
  'edit-vertices': { id: 'edit-vertices', label: 'Edit Vertices', icon: <Move className="w-3 h-3" />, hotkey: 'E' },
  'move-feature': { id: 'move-feature', label: 'Move Feature', icon: <Maximize className="w-3 h-3" />, hotkey: 'M' },
  'add-point': { id: 'add-point', label: 'Add Point(s)', icon: <MapPin className="w-3 h-3" />, hotkey: 'P' }
}

/** Applicable tools per section, gated on geometry — mirrors the old inline conditionals. */
function toolsForGeometry(
  geometryType: string,
  isEditMode: boolean
): { select: ToolDef[]; create: ToolDef[]; modify: ToolDef[] } {
  const isPoint = geometryType === 'POINT'
  const isPolygon = geometryType === 'POLYGON' || geometryType === 'MULTIPOLYGON'
  const isLine = geometryType === 'LINESTRING' || geometryType === 'MULTILINESTRING'

  const create: ToolDef[] = []
  if (isPoint) {
    create.push(TOOL_DEFS['add-point'])
  } else {
    create.push(TOOL_DEFS.draw)
    if (isPolygon) create.push(TOOL_DEFS.rectangle, TOOL_DEFS.circle)
    if (isPolygon || isLine) create.push(TOOL_DEFS.freehand, TOOL_DEFS.trace, TOOL_DEFS['offset-trace'])
  }

  const modify: ToolDef[] = isPoint ? [] : [TOOL_DEFS['edit-vertices'], TOOL_DEFS['move-feature']]
  const select: ToolDef[] = isEditMode ? [TOOL_DEFS.select] : []

  return { select, create, modify }
}

/**
 * Shared open/close + positioning for the ribbon's upward dropdowns. The panels
 * open above a bottom-of-window ribbon, but the ribbon's tool cluster uses
 * `overflow-x-auto` (which per CSS forces `overflow-y:auto`), so an in-flow
 * absolutely-positioned panel gets clipped away. Positioning the panel with
 * `position: fixed` (anchored to the trigger via getBoundingClientRect) escapes
 * that overflow clip. Returns the wrapper ref (click-outside boundary), the
 * open state, a `toggle` that measures on open, and the fixed `menuStyle`.
 */
function useUpwardMenu() {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; bottom: number }>({ left: 0, bottom: 0 })
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = () => {
    if (open) {
      setOpen(false)
      return
    }
    const r = ref.current?.getBoundingClientRect()
    if (r) setPos({ left: r.left, bottom: window.innerHeight - r.top + 4 })
    setOpen(true)
  }

  const menuStyle: React.CSSProperties = { position: 'fixed', left: pos.left, bottom: pos.bottom }
  return { open, setOpen, toggle, ref, menuStyle }
}

/** Split-button that collapses all mode buttons into one categorized dropdown. */
function ToolMenu({
  geometryType,
  isEditMode
}: {
  geometryType: string
  isEditMode: boolean
}): React.ReactElement {
  const activeToolId = useGeometryEditStore((s) => s.activeToolId)
  const setActiveTool = useGeometryEditStore((s) => s.setActiveTool)
  const { open, setOpen, toggle, ref, menuStyle } = useUpwardMenu()

  const groups = toolsForGeometry(geometryType, isEditMode)
  // Primary button always reflects the active tool; when nothing is active yet,
  // fall back to the first applicable create tool so the button still labels.
  const fallback = groups.create[0] ?? groups.select[0] ?? groups.modify[0] ?? TOOL_DEFS.draw
  const active = (activeToolId && TOOL_DEFS[activeToolId]) || fallback

  const sections: { key: string; label: string; tools: ToolDef[] }[] = [
    { key: 'select', label: 'Select', tools: groups.select },
    { key: 'create', label: 'Create', tools: groups.create },
    { key: 'modify', label: 'Modify', tools: groups.modify }
  ]

  return (
    <div className="relative flex items-center flex-shrink-0" ref={ref}>
      <button
        className={`pl-2 pr-1.5 py-1 text-xs rounded-l border border-r-0 flex items-center gap-1 whitespace-nowrap bg-geo-accent/10 text-geo-accent border-geo-accent`}
        onClick={() => setActiveTool(active.id)}
        title={`${active.label} (${active.hotkey})`}
      >
        {active.icon}
        {active.label}
      </button>
      <button
        className="px-0.5 py-1 rounded-r border bg-geo-accent/10 text-geo-accent border-geo-accent"
        onClick={toggle}
        title="Choose tool"
      >
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div style={menuStyle} className="fixed z-50 w-48 bg-geo-panel border border-geo-border rounded shadow-lg py-1">
          {sections
            .filter((s) => s.tools.length > 0)
            .map((s) => (
              <div key={s.key}>
                <div className="px-3 pt-1 pb-0.5 text-[10px] uppercase tracking-wide text-geo-muted">{s.label}</div>
                {s.tools.map((t) => (
                  <button
                    key={t.id}
                    className="flex items-center gap-2 w-full px-3 py-1 text-xs text-foreground hover:bg-geo-bg"
                    onClick={() => {
                      setActiveTool(t.id)
                      setOpen(false)
                    }}
                  >
                    <span className={t.id === activeToolId ? 'text-geo-accent' : 'text-geo-muted'}>{t.icon}</span>
                    <span className="flex-1 text-left">{t.label}</span>
                    <kbd className="text-[9px] text-geo-muted">{t.hotkey.split(' ·')[0]}</kbd>
                    {t.id === activeToolId && <Check className="w-3 h-3 text-geo-accent" />}
                  </button>
                ))}
              </div>
            ))}
        </div>
      )}
    </div>
  )
}

// ── Segment-type dropdown (straight + curve constructions) ───────────────────
// Replaces the old Arc toggle. All curve modes ultimately commit circular-arc
// segments; the draw tool interprets the mode as a click gesture.
const CURVE_DEFS: { mode: CurveMode; label: string; short: string; icon: React.ReactNode }[] = [
  { mode: 'none', label: 'Straight Line', short: 'Straight', icon: <Minus className="w-3 h-3" /> },
  { mode: 'arc', label: 'Arc Segment', short: 'Arc', icon: <Spline className="w-3 h-3" /> },
  { mode: 'endpoint-arc', label: 'Endpoint Arc', short: 'Endpt Arc', icon: <Radius className="w-3 h-3" /> },
  { mode: 'tangent', label: 'Tangent Curve', short: 'Tangent', icon: <Waypoints className="w-3 h-3" /> },
  { mode: 'bezier', label: 'Bézier Curve', short: 'Bézier', icon: <PenTool className="w-3 h-3" /> }
]

/** Dropdown selecting the draw tool's segment construction (straight or a curve type). */
function SegmentMenu(): React.ReactElement {
  const curveType = useGeometryEditStore((s) => s.curveType)
  const setCurveType = useGeometryEditStore((s) => s.setCurveType)
  const { open, setOpen, toggle, ref, menuStyle } = useUpwardMenu()

  const active = CURVE_DEFS.find((c) => c.mode === curveType) ?? CURVE_DEFS[0]
  const on = curveType !== 'none'

  return (
    <div className="relative flex items-center flex-shrink-0" ref={ref}>
      <button
        className={`px-2 py-1 text-xs rounded border flex items-center gap-1 whitespace-nowrap ${
          on
            ? 'bg-geo-accent/10 text-geo-accent border-geo-accent'
            : 'border-geo-border text-foreground hover:bg-geo-bg'
        }`}
        onClick={toggle}
        title="Segment type — straight or curve construction"
      >
        {active.icon}
        {active.short}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div style={menuStyle} className="fixed z-50 w-44 bg-geo-panel border border-geo-border rounded shadow-lg py-1">
          {CURVE_DEFS.map((c) => (
            <button
              key={c.mode}
              className="flex items-center gap-2 w-full px-3 py-1 text-xs text-foreground hover:bg-geo-bg"
              onClick={() => {
                setCurveType(c.mode)
                setOpen(false)
              }}
            >
              <span className={c.mode === curveType ? 'text-geo-accent' : 'text-geo-muted'}>{c.icon}</span>
              <span className="flex-1 text-left">{c.label}</span>
              {c.mode === curveType && <Check className="w-3 h-3 text-geo-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Precise vertex entry: "lng, lat" absolute or "d<meters> a<degrees>" from the last vertex. */
function CadInput(): React.ReactElement {
  const [value, setValue] = useState('')
  const [invalid, setInvalid] = useState(false)
  const addVertex = useGeometryEditStore((s) => s.addVertex)

  const submit = () => {
    const store = useGeometryEditStore.getState()
    const session = selectActiveSession(store)
    if (!session) return
    const verts = getPath(session.draft, session.activePath)?.vertices ?? []
    const last = verts[verts.length - 1] ?? null
    const parsed = parseCadInput(value, last)
    if (!parsed) {
      setInvalid(true)
      return
    }
    addVertex(parsed.position[0], parsed.position[1])
    setValue('')
    setInvalid(false)
  }

  return (
    <input
      type="text"
      value={value}
      placeholder="lng,lat · d100 a45"
      title="Precise vertex entry — absolute 'lng, lat' or 'd<meters> a<degrees from north>' from the last vertex; Enter places the vertex"
      className={`w-32 flex-shrink-0 bg-geo-bg border rounded px-1.5 py-1 text-xs text-foreground outline-none placeholder:text-geo-muted/60 ${
        invalid ? 'border-geo-error' : 'border-geo-border focus:border-geo-accent'
      }`}
      onChange={(e) => {
        setValue(e.target.value)
        if (invalid) setInvalid(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          submit()
        }
      }}
    />
  )
}

const SNAP_KIND_LABELS: { key: keyof SnapSettings['kinds']; label: string }[] = [
  { key: 'vertex', label: 'Vertices' },
  { key: 'edge', label: 'Edges' },
  { key: 'midpoint', label: 'Midpoints' },
  { key: 'intersection', label: 'Intersections' }
]

/** Snap toggle + per-kind/tolerance dropdown; settings persist across sessions. */
function SnapControl(): React.ReactElement {
  const isSnapping = useGeometryEditStore((s) => s.isSnapping)
  const setSnapping = useGeometryEditStore((s) => s.setSnapping)
  const snapSettings = useSpatialSettingsStore((s) => s.snapSettings)
  const setSnapSettings = useSpatialSettingsStore((s) => s.setSnapSettings)
  const initialExtentMode = useSpatialSettingsStore((s) => s.initialExtentMode)
  const userExtent = useSpatialSettingsStore((s) => s.userExtent)
  const { open, toggle, ref, menuStyle } = useUpwardMenu()

  const update = (next: SnapSettings) => {
    setSnapSettings(next)
    void saveSpatialSettings(initialExtentMode, userExtent, next)
  }

  return (
    <div className="relative flex items-center flex-shrink-0" ref={ref}>
      <button
        className={`pl-2 pr-1 py-1 text-xs rounded-l border flex items-center gap-1 ${
          isSnapping
            ? 'bg-geo-accent/10 text-geo-accent border-geo-accent'
            : 'border-geo-border text-foreground hover:bg-geo-bg'
        }`}
        onClick={() => setSnapping(!isSnapping)}
        title="Toggle snapping"
      >
        <Magnet className="w-3 h-3" />
        Snap
      </button>
      <button
        className={`px-0.5 py-1 rounded-r border border-l-0 ${
          isSnapping
            ? 'bg-geo-accent/10 text-geo-accent border-geo-accent'
            : 'border-geo-border text-geo-muted hover:bg-geo-bg'
        }`}
        onClick={toggle}
        title="Snapping options"
      >
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div style={menuStyle} className="fixed z-50 w-44 bg-geo-panel border border-geo-border rounded shadow-lg p-2 flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-geo-muted">Snap to</span>
          {SNAP_KIND_LABELS.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
              <input
                type="checkbox"
                className="accent-[#4493f8]"
                checked={snapSettings.kinds[key]}
                onChange={(e) =>
                  update({
                    ...snapSettings,
                    kinds: { ...snapSettings.kinds, [key]: e.target.checked }
                  })
                }
              />
              {label}
            </label>
          ))}
          <div className="h-px bg-geo-border my-0.5" />
          <label className="flex items-center justify-between gap-2 text-xs text-foreground">
            Tolerance
            <span className="flex items-center gap-1">
              <input
                type="number"
                min={2}
                max={50}
                className="w-12 bg-geo-bg border border-geo-border rounded px-1 py-0.5 text-xs text-foreground outline-none focus:border-geo-accent"
                value={snapSettings.tolerancePx}
                onChange={(e) => {
                  const v = Math.max(2, Math.min(50, Number(e.target.value) || 15))
                  update({ ...snapSettings, tolerancePx: v })
                }}
              />
              <span className="text-geo-muted">px</span>
            </span>
          </label>
        </div>
      )}
    </div>
  )
}

export function GeometryEditRibbon(): React.ReactElement | null {
  const session = useGeometryEditStore(selectActiveSession)
  const isEditMode = useGeometryEditStore((s) => s.isEditMode)
  const activeToolId = useGeometryEditStore((s) => s.activeToolId)
  const pendingRowAdd = useGeometryEditStore((s) => s.pendingRowAdd)
  const setActiveTool = useGeometryEditStore((s) => s.setActiveTool)
  const offsetDistance = useGeometryEditStore((s) => s.offsetDistance)
  const setOffsetDistance = useGeometryEditStore((s) => s.setOffsetDistance)
  const undoVertex = useGeometryEditStore((s) => s.undoVertex)
  const startNextPart = useGeometryEditStore((s) => s.startNextPart)
  const startNewHole = useGeometryEditStore((s) => s.startNewHole)
  const redoDraft = useGeometryEditStore((s) => s.redoDraft)
  const commitLogLen = useGeometryEditStore((s) => s.commitLog.length)
  const stopEditing = useGeometryEditStore((s) => s.stopEditing)
  const setEditMode = useGeometryEditStore((s) => s.setEditMode)
  const startEditing = useGeometryEditStore((s) => s.startEditing)
  const { finish, cancel, undoLast } = useDrawActions()
  const { confirmPendingRowAdd, declinePendingRowAdd } = useAddFeature()
  const layers = useSpatialStore((s) => s.layers)

  if (!isEditMode && !session) return null

  const snapBtn = <SnapControl />

  const toolBtn = (id: ToolId, label: string, icon: React.ReactNode, hotkey: string) => (
    <RibbonButton
      key={id}
      active={activeToolId === id}
      title={`${label} (${hotkey})`}
      onClick={() => setActiveTool(id)}
    >
      {icon}
      {label}
    </RibbonButton>
  )

  // ── Inline "add another feature?" prompt (replaces the old modal) ──────────
  if (session && pendingRowAdd) {
    const displayName = session.accessPath.split('$')[0] || session.accessPath
    return (
      <div className="h-10 flex-shrink-0 flex items-center gap-2 px-3 bg-geo-panel border-t border-geo-accent/40">
        <Check className="w-3.5 h-3.5 text-geo-success" />
        <span className="text-xs text-foreground">
          Feature saved to <span className="text-geo-accent">{displayName}</span> — add another?
        </span>
        <RibbonButton accent title="Add a new row and keep drawing (Enter)" onClick={() => void confirmPendingRowAdd()}>
          <Plus className="w-3 h-3" />
          Add another
          <kbd className="ml-1 text-[9px] text-geo-muted">Enter</kbd>
        </RibbonButton>
        <RibbonButton title="Finish and close the drawing session (Esc)" onClick={declinePendingRowAdd}>
          Finish
          <kbd className="ml-1 text-[9px] text-geo-muted">Esc</kbd>
        </RibbonButton>
      </div>
    )
  }

  // ── Edit Mode on, no feature selected — show select prompt ────────────────
  if (isEditMode && !session) {
    const pointLayer = layers.find(
      (l) => l.visible && l.geometryType.toUpperCase() === 'POINT'
    )
    return (
      <div className="h-10 flex-shrink-0 flex items-center gap-2 px-3 bg-geo-panel border-t border-geo-border">
        {snapBtn}
        <Divider />
        {toolBtn('select', 'Select', <MousePointer2 className="w-3 h-3" />, 'S')}
        {pointLayer && (
          <RibbonButton
            active={activeToolId === 'add-point'}
            title="Add point features — each click appends a row"
            onClick={() => {
              startEditing({
                accessPath: pointLayer.name,
                envName: pointLayer.envName,
                columnName: pointLayer.columnName,
                colLib: pointLayer.colLib,
                geometryType: 'POINT',
                currentRow: 0,
                totalRows: pointLayer.geojson.features.length,
                originalGeometry: null
              })
              setActiveTool('add-point')
            }}
          >
            <MapPin className="w-3 h-3" />
            Add Point(s)
          </RibbonButton>
        )}
        <span className="text-[10px] text-geo-muted ml-1">Edit Mode — click a feature on the map</span>
        <RibbonButton title="Leave edit mode" onClick={() => setEditMode(false)}>
          Exit Edit Mode
        </RibbonButton>
      </div>
    )
  }

  if (!session) return null

  // ── Active session — unified tool palette ──────────────────────────────────
  const { geometryType, currentRow, totalRows, accessPath, draft, activePath, undoStack, redoStack } = session
  const displayName = accessPath.split('$')[0] || accessPath
  const isPoint = geometryType === 'POINT'
  const isPolygon = geometryType === 'POLYGON' || geometryType === 'MULTIPOLYGON'
  const isLine = geometryType === 'LINESTRING' || geometryType === 'MULTILINESTRING'
  const activePathLen = getPath(draft, activePath)?.vertices.length ?? 0

  return (
    <div className="h-10 flex-shrink-0 flex items-center gap-2 px-3 bg-geo-panel border-t border-geo-border">
      {/* Tools + helpers scroll horizontally on a narrow panel (scrollbar hidden);
          the primary actions below are pinned so they never clip off-screen. */}
      <div className="flex items-center gap-2 min-w-0 flex-1 overflow-x-auto [&::-webkit-scrollbar]:hidden">
        {snapBtn}
        <Divider />
        <ToolMenu geometryType={geometryType} isEditMode={isEditMode} />
        {(isPolygon || isLine) && activeToolId === 'draw' && <SegmentMenu />}
        {activeToolId === 'offset-trace' && (
          <label className="flex items-center gap-1 text-xs text-geo-muted flex-shrink-0">
            <input
              type="number"
              className="w-16 bg-geo-bg border border-geo-border rounded px-1 py-0.5 text-xs text-foreground outline-none focus:border-geo-accent"
              value={offsetDistance}
              step={1}
              title="Perpendicular offset distance in meters (negative = other side)"
              onChange={(e) => setOffsetDistance(Number(e.target.value) || 0)}
            />
            m
          </label>
        )}
        {activeToolId === 'draw' && !isPoint && <CadInput />}
        {!isPoint && (
          <>
            <Divider />
            <RibbonButton
              disabled={undoStack.length === 0 && commitLogLen === 0}
              title="Undo — draft edits first, then staged commits (Ctrl+Z)"
              onClick={() => void undoLast()}
            >
              <Undo2 className="w-3 h-3" />
            </RibbonButton>
            <RibbonButton
              disabled={redoStack.length === 0}
              title="Redo (Ctrl+Y)"
              onClick={redoDraft}
            >
              <Redo2 className="w-3 h-3" />
            </RibbonButton>
            <RibbonButton
              disabled={activePathLen === 0}
              title="Remove last vertex (Backspace)"
              onClick={undoVertex}
            >
              Undo Vertex
            </RibbonButton>
            {canStartHole(session) && (
              <RibbonButton title="Start drawing a hole in the polygon (H)" onClick={startNewHole}>
                <Circle className="w-3 h-3" />
                Hole
              </RibbonButton>
            )}
            {canStartNextPart(session) && (
              <RibbonButton title="Save current part and start the next (N)" onClick={startNextPart}>
                <Plus className="w-3 h-3" />
                Next Part
              </RibbonButton>
            )}
          </>
        )}
        {isEditMode && (
          <RibbonButton title="Leave edit mode" onClick={() => setEditMode(false)}>
            Exit Edit Mode
          </RibbonButton>
        )}
        <span className="ml-auto pl-2 text-[10px] text-geo-muted whitespace-nowrap flex-shrink-0">
          {displayName} — row {currentRow + 1} / {totalRows} &nbsp;|&nbsp; {geometryType}
        </span>
      </div>
      {/* Pinned primary actions — always visible regardless of panel width. */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {!isPoint && (
          <RibbonButton
            accent
            disabled={!canComplete(session)}
            title="Commit geometry and advance to next row (Enter or double-click)"
            onClick={() => void finish()}
          >
            <Check className="w-3 h-3" />
            Complete
            <kbd className="ml-1 text-[9px] opacity-70">Enter</kbd>
          </RibbonButton>
        )}
        <RibbonButton
          danger
          title={isPoint ? 'End the drawing session' : 'Stop editing, discard pending draft (Esc)'}
          onClick={() => (isPoint ? stopEditing() : cancel())}
        >
          <X className="w-3 h-3" />
          {isPoint ? 'End Draw' : 'Cancel'}
          {!isPoint && <kbd className="ml-1 text-[9px] opacity-70">Esc</kbd>}
        </RibbonButton>
      </div>
    </div>
  )
}
