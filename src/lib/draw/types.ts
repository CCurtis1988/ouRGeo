import type maplibregl from 'maplibre-gl'
import type { SnapTarget } from '@/store/geometryEdit'

/**
 * Identifiers for the drawing/editing tools. Phase 2 ships the core set plus
 * move-feature; shape and CAD tools (rectangle, circle, freehand, trace,
 * offset-trace) arrive in later phases behind the same interface.
 */
export type ToolId =
  | 'select'
  | 'draw'
  | 'edit-vertices'
  | 'move-feature'
  | 'add-point'
  | 'rectangle'
  | 'circle'
  | 'freehand'
  | 'trace'
  | 'offset-trace'

// ── Draft geometry model ─────────────────────────────────────────────────────

export type Position = [number, number]

/**
 * How the segment joining vertices[i] → vertices[i+1] is rendered. 'line' is
 * a straight segment; arcs (Phase 5) stay symbolic via their through-point
 * and are densified at render/commit time.
 */
export type SegmentKind = 'line' | { kind: 'arc'; via: Position }

/**
 * Active segment-construction mode for the draw tool. All curve modes ultimately
 * produce circular-arc segments; they differ only in the click gesture used to
 * derive the arc. 'none' draws straight segments.
 */
export type CurveMode = 'none' | 'arc' | 'endpoint-arc' | 'tangent' | 'bezier'

/** One open or closable run of vertices (a ring, line part, or point set). */
export interface DraftPath {
  vertices: Position[]
  /** segments[i] joins vertices[i] → vertices[i+1]; length = vertices.length - 1. */
  segments: SegmentKind[]
}

/** One part of a (multi-)geometry: an exterior path plus interior rings (polygon holes). */
export interface DraftPart {
  exterior: DraftPath
  holes: DraftPath[]
}

/** The in-progress drawing. Geometry type lives on the session. */
export interface DraftGeometry {
  parts: DraftPart[]
}

/** Address of a path inside a draft: ring 0 = exterior, ring n ≥ 1 = holes[n-1]. */
export interface PathRef {
  part: number
  ring: number
}

/** Address of a single vertex inside a draft. */
export interface VertexRef extends PathRef {
  vertex: number
}

// ── Tool interface ───────────────────────────────────────────────────────────

/** A normalized pointer event delivered to tools. `lngLat` is snapped when a snap target is active. */
export interface DrawPointerEvent {
  lngLat: Position
  rawLngLat: Position
  point: { x: number; y: number }
  snap: SnapTarget | null
  shiftKey: boolean
  ctrlKey: boolean
}

export interface DrawContextMenuItem {
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}

/**
 * Capabilities injected into tools by the React layer. Tools read/write
 * drawing state directly through the zustand stores (they are importable
 * outside React); only map access and commit semantics — which live in
 * React hooks — need injection.
 */
export interface DrawToolContext {
  getMap(): maplibregl.Map | null
  /** Complete the current draft: densify, commit, advance row. */
  finish(): Promise<void>
  /** Discard the draft, restore the row's original geometry, end the session. */
  cancel(): void
  /** add-point tool: append a new row with a POINT at lng/lat. */
  commitPoint(lng: number, lat: number): Promise<void>
}

/**
 * A drawing tool. Tools are stateful singletons owned by the ToolManager;
 * transient state (e.g. an in-progress vertex drag) lives on the instance
 * and must be reset in onDeactivate.
 *
 * onMouseDown returning `true` means the tool captured the gesture and map
 * panning should stay suppressed until mouse-up.
 */
export interface DrawTool {
  readonly id: ToolId
  cursor(): string
  onActivate?(ctx: DrawToolContext): void
  onDeactivate?(ctx: DrawToolContext): void
  onClick?(e: DrawPointerEvent, ctx: DrawToolContext): void
  onDblClick?(e: DrawPointerEvent, ctx: DrawToolContext): void
  onMouseDown?(e: DrawPointerEvent, ctx: DrawToolContext): boolean | void
  onMouseMove?(e: DrawPointerEvent, ctx: DrawToolContext): void
  onMouseUp?(e: DrawPointerEvent, ctx: DrawToolContext): void
  onContextMenu?(e: DrawPointerEvent, ctx: DrawToolContext): DrawContextMenuItem[] | void
}
