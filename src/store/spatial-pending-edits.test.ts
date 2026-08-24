import { describe, it, expect, beforeEach } from 'vitest'
import { useSpatialStore, pendingGroupKey } from './spatial'
import type { PendingEditMeta } from './spatial'

const memMeta: PendingEditMeta = {
  source: 'memory',
  accessPath: 'parcels',
  envName: '.GlobalEnv',
  columnName: 'geometry',
  colLib: 'sf'
}
const memKey = pendingGroupKey(memMeta)

const pointAt = (x: number): GeoJSON.Geometry => ({ type: 'Point', coordinates: [x, 0] })

beforeEach(() => {
  useSpatialStore.setState({ pendingGeometryEdits: {}, pendingEditMeta: {}, layers: [] })
})

describe('pendingGroupKey', () => {
  it('uses the layer id when on-map, else a synthetic memory key', () => {
    expect(pendingGroupKey({ layerId: 'layer-1', accessPath: 'x', envName: 'e' })).toBe('layer-1')
    expect(pendingGroupKey(memMeta)).toBe('mem::parcels::.GlobalEnv')
  })
})

describe('addPendingGeometryEdit', () => {
  it('merges geometry edits per row, preserving the first originalGeometry', () => {
    const s = useSpatialStore.getState()
    s.addPendingGeometryEdit(memMeta, {
      rowId: 3,
      kind: 'geometry',
      geometry: pointAt(1),
      originalGeometry: pointAt(0)
    })
    s.addPendingGeometryEdit(memMeta, {
      rowId: 3,
      kind: 'geometry',
      geometry: pointAt(2),
      originalGeometry: pointAt(1)
    })
    const edits = useSpatialStore.getState().pendingGeometryEdits[memKey]
    expect(edits).toHaveLength(1)
    expect(edits[0].geometry).toEqual(pointAt(2))
    expect(edits[0].originalGeometry).toEqual(pointAt(0))
    expect(useSpatialStore.getState().pendingEditMeta[memKey]).toEqual(memMeta)
  })

  it('keeps row-add entries distinct from geometry entries for the same row', () => {
    const s = useSpatialStore.getState()
    s.addPendingGeometryEdit(memMeta, { rowId: 5, kind: 'row-add', originalGeometry: null })
    s.addPendingGeometryEdit(memMeta, { rowId: 5, kind: 'geometry', geometry: pointAt(1) })
    const edits = useSpatialStore.getState().pendingGeometryEdits[memKey]
    expect(edits).toHaveLength(2)
    expect(edits.map((e) => e.kind).sort()).toEqual(['geometry', 'row-add'])
  })
})

describe('restoreStagedEdit (commit undo)', () => {
  it('puts back the previous staged entry, or removes the group when empty', () => {
    const s = useSpatialStore.getState()
    const prev = { rowId: 3, kind: 'geometry' as const, geometry: pointAt(1), originalGeometry: pointAt(0) }
    s.addPendingGeometryEdit(memMeta, prev)
    s.addPendingGeometryEdit(memMeta, { rowId: 3, kind: 'geometry', geometry: pointAt(2) })

    s.restoreStagedEdit(memKey, 3, prev, pointAt(1))
    const edits = useSpatialStore.getState().pendingGeometryEdits[memKey]
    expect(edits).toHaveLength(1)
    expect(edits[0].geometry).toEqual(pointAt(1))

    s.restoreStagedEdit(memKey, 3, null, pointAt(0))
    expect(useSpatialStore.getState().pendingGeometryEdits[memKey]).toBeUndefined()
    expect(useSpatialStore.getState().pendingEditMeta[memKey]).toBeUndefined()
  })
})

describe('unstageRow', () => {
  it('drops every entry for the row (row-add undo)', () => {
    const s = useSpatialStore.getState()
    s.addPendingGeometryEdit(memMeta, { rowId: 7, kind: 'row-add', originalGeometry: null })
    s.addPendingGeometryEdit(memMeta, { rowId: 7, kind: 'geometry', geometry: pointAt(1) })
    s.addPendingGeometryEdit(memMeta, { rowId: 2, kind: 'geometry', geometry: pointAt(9) })

    s.unstageRow(memKey, 7)
    const edits = useSpatialStore.getState().pendingGeometryEdits[memKey]
    expect(edits).toHaveLength(1)
    expect(edits[0].rowId).toBe(2)
  })
})
