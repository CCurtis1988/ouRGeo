import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  distanceBearingTool, traversePath, traverseOrigin, traverseIncoming, previewLeg,
  usesReferencePoint, appendsRows, undoTraverseLeg,
} from './distance-bearing'
import { useGeometryEditStore, selectActiveSession } from '@/store/geometryEdit'
import { useTraverseStore } from '@/store/traverse'
import { destination, inverse } from '../cogo'
import type { DrawPointerEvent, DrawToolContext, Position } from '../types'
import type { GeometryType } from '@/store/geometryEdit'

function startSession(
  geometryType: GeometryType,
  over: { currentRow?: number; totalRows?: number; appendRows?: boolean } = {}
): void {
  useGeometryEditStore.getState().startEditing({
    accessPath: 'roads',
    envName: '.GlobalEnv',
    columnName: 'geometry',
    colLib: 'sf',
    geometryType,
    currentRow: 0,
    totalRows: 1,
    originalGeometry: null,
    ...over,
  })
  useGeometryEditStore.getState().setActiveTool('distance-bearing')
}

const session = () => selectActiveSession(useGeometryEditStore.getState())!

const click = (lng: number, lat: number): DrawPointerEvent => ({
  lngLat: [lng, lat], rawLngLat: [lng, lat], point: { x: 0, y: 0 },
  snap: null, shiftKey: false, ctrlKey: false,
})

function ctx(): DrawToolContext & {
  commitPoint: ReturnType<typeof vi.fn>
  undoLast: ReturnType<typeof vi.fn>
} {
  const commitPoint = vi.fn().mockResolvedValue(undefined)
  const undoLast = vi.fn().mockResolvedValue(undefined)
  return {
    getMap: () => null,
    finish: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn(),
    commitPoint,
    undoLast,
  }
}

beforeEach(() => {
  useGeometryEditStore.setState({
    namedSessions: [], activeSessionId: null, isEditMode: false,
    activeToolId: null, pendingRowAdd: false, commitLog: [],
  })
  useTraverseStore.getState().reset()
})

describe('where the next leg starts', () => {
  it('reads a line’s trail out of the draft, where undo can reach it', () => {
    // Not out of the store: the ribbon's Undo Vertex knows nothing about this
    // tool, and a strip measuring from a vertex that had been undone would
    // put every following leg in the wrong place.
    startSession('LINESTRING')
    useGeometryEditStore.getState().addVertex(10, 20)
    useGeometryEditStore.getState().addVertex(11, 21)
    expect(traversePath(session(), [])).toEqual([[10, 20], [11, 21]])

    useGeometryEditStore.getState().undoVertex()
    expect(traverseOrigin(session(), [])).toEqual([10, 20])
  })

  it('reads a point traverse’s trail out of the store, because it has no draft', () => {
    startSession('POINT')
    const path: Position[] = [[10, 20], [10.001, 20]]
    expect(traversePath(session(), path)).toBe(path)
    expect(traverseOrigin(session(), path)).toEqual([10.001, 20])
  })

  it('has no origin until something has been placed', () => {
    startSession('LINESTRING')
    expect(traverseOrigin(session(), [])).toBeNull()
    expect(traverseIncoming(session(), [])).toBeNull()
  })
})

describe('what a relative bearing turns from', () => {
  it('is the azimuth the last leg ARRIVED on, not the one it left on', () => {
    startSession('LINESTRING')
    const a: Position = [0, 60]
    const b = destination(a, 200000, 90)
    useGeometryEditStore.getState().addVertex(a[0], a[1])
    useGeometryEditStore.getState().addVertex(b[0], b[1])

    const incoming = traverseIncoming(session(), [])!
    const leg = inverse(a, b)
    expect(incoming).toBeCloseTo(leg.finalAzimuth, 9)
    // 200 km due east at 60°N arrives pointing appreciably south of east.
    expect(incoming - leg.initialAzimuth).toBeGreaterThan(1)
  })
})

describe('where a leg lands', () => {
  const origin: Position = [-122.4194, 37.7749]

  it('walks the geodesic when that is the basis', () => {
    expect(previewLeg(origin, 150, 45, 'geodesic', null))
      .toEqual(destination(origin, 150, 45))
  })

  it('reduces a grid leg through the frame R reported for this vertex', () => {
    // The committed vertex is always R's projected arithmetic; this is what
    // lets the ghost follow the keystrokes without a round trip per character.
    const frame = { x: 0, y: 0, convergence: -1.5, scale: 0.9996 }
    expect(previewLeg(origin, 1000, 45, 'grid', frame))
      .toEqual(destination(origin, 1000 / 0.9996, 43.5))
  })

  it('falls back to the geodesic while the frame is still on its way', () => {
    expect(previewLeg(origin, 1000, 45, 'grid', null))
      .toEqual(destination(origin, 1000, 45))
  })
})

describe('the tool', () => {
  it('places the first click as a vertex, and every later one too', () => {
    // Clicking is not forbidden once a traverse is running: a traverse with
    // one eyeballed corner is a real thing, and the tool is about being able
    // to type, not about being forbidden to point.
    startSession('LINESTRING')
    const c = ctx()
    distanceBearingTool.onClick!(click(10, 20), c)
    distanceBearingTool.onClick!(click(11, 21), c)
    expect(traversePath(session(), [])).toEqual([[10, 20], [11, 21]])
    expect(c.commitPoint).not.toHaveBeenCalled()
  })

  it('places a REFERENCE point on a POINT layer, not a feature', () => {
    // The mark a set of points is shot from is usually not one of them, and
    // every row of a point layer is its own feature — so a click that answered
    // "where am I measuring from?" by writing a row would be answering a
    // different question.
    startSession('POINT')
    const c = ctx()
    distanceBearingTool.onClick!(click(10, 20), c)
    expect(c.commitPoint).not.toHaveBeenCalled()
    expect(useTraverseStore.getState().path).toEqual([[10, 20]])
    expect(selectActiveSession(useGeometryEditStore.getState())!.currentRow).toBe(0)
  })

  it('re-places the reference on a later click, and starts the run again', () => {
    startSession('POINT')
    const c = ctx()
    distanceBearingTool.onClick!(click(10, 20), c)
    useTraverseStore.getState().pushVertex([10.001, 20])
    distanceBearingTool.onClick!(click(30, 40), c)
    // Not appended to the old run: the chain the traverse describes has been
    // broken, so what follows is a new one from the new mark.
    expect(useTraverseStore.getState().path).toEqual([[30, 40]])
  })

  it('forgets the run when the tool is put down, and keeps the preferences', () => {
    startSession('POINT')
    useTraverseStore.getState().setUnit('usft')
    distanceBearingTool.onClick!(click(10, 20), ctx())
    distanceBearingTool.onDeactivate!(ctx())
    expect(useTraverseStore.getState().path).toEqual([])
    expect(useTraverseStore.getState().unit).toBe('usft')
  })

  it('offers undo, finish and cancel on right-click, and disables what cannot run', () => {
    startSession('LINESTRING')
    const items = distanceBearingTool.onContextMenu!(click(10, 20), ctx()) || []
    expect(items.map((i) => i.label)).toEqual(['Finish feature', 'Undo leg', 'Cancel drawing'])
    expect(items.find((i) => i.label === 'Undo leg')?.disabled).toBe(true)
  })

  it('undoes one leg, from the draft or the store depending on the geometry', async () => {
    startSession('LINESTRING')
    const c = ctx()
    distanceBearingTool.onClick!(click(10, 20), c)
    distanceBearingTool.onClick!(click(11, 21), c)
    const items = distanceBearingTool.onContextMenu!(click(11, 21), c) || []
    items.find((i) => i.label === 'Undo leg')!.onClick()
    await Promise.resolve()
    expect(traversePath(session(), [])).toEqual([[10, 20]])
    expect(c.undoLast).not.toHaveBeenCalled()
  })
})

describe('which session a point traverse is running in', () => {
  it('measures from a reference on a point layer and from a vertex elsewhere', () => {
    startSession('POINT')
    expect(usesReferencePoint(session())).toBe(true)
    startSession('MULTIPOINT')
    // A multipoint's parts live in one draft and commit together, so its first
    // part is a vertex like any other.
    expect(usesReferencePoint(session())).toBe(false)
  })

  it('fills rows by default, and appends only where the session says so', () => {
    startSession('POINT')
    expect(appendsRows(session())).toBe(false)
    startSession('POINT', { appendRows: true })
    expect(appendsRows(session())).toBe(true)
  })
})

describe('taking back a placed point', () => {
  it('undoes the commit AND the row the session moved on to', async () => {
    // Undoing only the staged geometry would leave the next leg writing into
    // the row after the one it had just emptied.
    startSession('POINT', { currentRow: 2, totalRows: 5 })
    useTraverseStore.getState().pushVertex([10, 20])
    useTraverseStore.getState().pushVertex([10.001, 20])
    const c = ctx()
    await undoTraverseLeg(c)
    expect(c.undoLast).toHaveBeenCalled()
    expect(session().currentRow).toBe(1)
    expect(useTraverseStore.getState().path).toEqual([[10, 20]])
  })

  it('cancels the "add another row?" prompt rather than moving the row', async () => {
    // That commit ran out of dataset; it never advanced anything.
    startSession('POINT', { currentRow: 4, totalRows: 5 })
    useTraverseStore.getState().pushVertex([10, 20])
    useTraverseStore.getState().pushVertex([10.001, 20])
    useGeometryEditStore.getState().requestRowAdd()
    await undoTraverseLeg(ctx())
    expect(useGeometryEditStore.getState().pendingRowAdd).toBe(false)
    expect(session().currentRow).toBe(4)
  })

  it('leaves the row alone when the session appends rows — the undo deleted it', async () => {
    startSession('POINT', { currentRow: 0, totalRows: 3, appendRows: true })
    useTraverseStore.getState().pushVertex([10, 20])
    useTraverseStore.getState().pushVertex([10.001, 20])
    const c = ctx()
    await undoTraverseLeg(c)
    expect(c.undoLast).toHaveBeenCalled()
    expect(session().currentRow).toBe(0)
  })

  it('has nothing to take back while the run is only its reference', async () => {
    startSession('POINT')
    useTraverseStore.getState().pushVertex([10, 20])
    const c = ctx()
    await undoTraverseLeg(c)
    expect(c.undoLast).not.toHaveBeenCalled()
    expect(useTraverseStore.getState().path).toEqual([[10, 20]])
  })
})
