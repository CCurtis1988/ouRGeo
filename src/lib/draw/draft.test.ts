import { describe, it, expect } from 'vitest'
import {
  emptyDraft,
  geometryToDraft,
  draftToGeoJSON,
  appendVertex,
  insertVertexAfter,
  moveVertex,
  removeVertex,
  removeLastVertex,
  startPart,
  startHole,
  dropEmptyPath,
  translateDraft,
  canComplete,
  canStartNextPart,
  canStartHole,
  computeMidpointHandles,
  allPaths,
  getPath
} from './draft'
import type { DraftGeometry, Position } from './types'
import type { GeometryEditSession, GeometryType } from '@/store/geometryEdit'

const P0 = { part: 0, ring: 0 }

function draftWith(vertices: Position[], type?: 'closed'): DraftGeometry {
  let d = emptyDraft()
  for (const v of vertices) d = appendVertex(d, P0, v)
  void type
  return d
}

function session(
  geometryType: GeometryType,
  draft: DraftGeometry,
  activePath = P0
): GeometryEditSession {
  return {
    accessPath: 'df',
    envName: '.GlobalEnv',
    columnName: 'geometry',
    colLib: 'sf',
    geometryType,
    currentRow: 0,
    totalRows: 1,
    draft,
    activePath,
    undoStack: [],
    redoStack: [],
    originalGeometry: null,
    committedFeatures: []
  }
}

const tri: Position[] = [[0, 0], [4, 0], [4, 4]]

describe('draft mutations', () => {
  it('appendVertex keeps segments in sync', () => {
    const d = draftWith(tri)
    const path = getPath(d, P0)!
    expect(path.vertices).toHaveLength(3)
    expect(path.segments).toHaveLength(2)
  })

  it('insertVertexAfter splits an edge', () => {
    const d = insertVertexAfter(draftWith(tri), P0, 0, [2, 0])
    const path = getPath(d, P0)!
    expect(path.vertices).toEqual([[0, 0], [2, 0], [4, 0], [4, 4]])
    expect(path.segments).toHaveLength(3)
  })

  it('moveVertex replaces a single position', () => {
    const d = moveVertex(draftWith(tri), { ...P0, vertex: 1 }, [9, 9])
    expect(getPath(d, P0)!.vertices[1]).toEqual([9, 9])
  })

  it('removeVertex respects the geometry-type minimum', () => {
    const d = draftWith(tri)
    // POLYGON minimum is 3 — removal refused
    expect(removeVertex(d, { ...P0, vertex: 0 }, 'POLYGON')).toBe(d)
    // LINESTRING minimum is 2 — removal allowed
    const removed = removeVertex(d, { ...P0, vertex: 0 }, 'LINESTRING')
    expect(getPath(removed, P0)!.vertices).toEqual([[4, 0], [4, 4]])
  })

  it('removeLastVertex pops from the end', () => {
    const d = removeLastVertex(draftWith(tri), P0)
    expect(getPath(d, P0)!.vertices).toHaveLength(2)
  })

  it('startPart/startHole extend the draft and return the new active path', () => {
    const { draft: d2, active: partActive } = startPart(draftWith(tri))
    expect(d2.parts).toHaveLength(2)
    expect(partActive).toEqual({ part: 1, ring: 0 })

    const { draft: d3, active: holeActive } = startHole(draftWith(tri), 0)
    expect(d3.parts[0].holes).toHaveLength(1)
    expect(holeActive).toEqual({ part: 0, ring: 1 })
  })

  it('dropEmptyPath removes an abandoned hole and refocuses the exterior', () => {
    const { draft: withHole, active } = startHole(draftWith(tri), 0)
    const { draft, active: newActive } = dropEmptyPath(withHole, active)
    expect(draft.parts[0].holes).toHaveLength(0)
    expect(newActive).toEqual(P0)
  })

  it('translateDraft shifts every vertex', () => {
    const d = translateDraft(draftWith(tri), 1, 2)
    expect(getPath(d, P0)!.vertices).toEqual([[1, 2], [5, 2], [5, 6]])
  })
})

describe('draftToGeoJSON', () => {
  it('builds a Point / LineString / Polygon', () => {
    expect(draftToGeoJSON(draftWith([[1, 2]]), 'POINT')).toEqual({
      type: 'Point',
      coordinates: [1, 2]
    })
    expect(draftToGeoJSON(draftWith([[0, 0], [1, 1]]), 'LINESTRING')).toEqual({
      type: 'LineString',
      coordinates: [[0, 0], [1, 1]]
    })
    const poly = draftToGeoJSON(draftWith(tri), 'POLYGON')
    expect(poly).toEqual({
      type: 'Polygon',
      coordinates: [[[0, 0], [4, 0], [4, 4], [0, 0]]]
    })
  })

  it('includes closed polygon holes', () => {
    const start = startHole(draftWith([[0, 0], [10, 0], [10, 10], [0, 10]]), 0)
    const active = start.active
    let draft = start.draft
    for (const v of [[2, 2], [4, 2], [4, 4]] as Position[]) draft = appendVertex(draft, active, v)
    const g = draftToGeoJSON(draft, 'POLYGON') as GeoJSON.Polygon
    expect(g.coordinates).toHaveLength(2)
    expect(g.coordinates[1]).toEqual([[2, 2], [4, 2], [4, 4], [2, 2]])
  })

  it('strict mode rejects malformed holes, lenient mode drops them', () => {
    const start = startHole(draftWith(tri), 0)
    const active = start.active
    let draft = start.draft
    draft = appendVertex(draft, active, [1, 1]) // 1-vertex hole = malformed
    expect(draftToGeoJSON(draft, 'POLYGON')).toBeNull()
    const lenient = draftToGeoJSON(draft, 'POLYGON', { lenient: true }) as GeoJSON.Polygon
    expect(lenient.coordinates).toHaveLength(1)
  })

  it('builds MultiPolygon from parts', () => {
    const start = startPart(draftWith(tri))
    const active = start.active
    let draft = start.draft
    for (const v of [[10, 10], [14, 10], [14, 14]] as Position[]) {
      draft = appendVertex(draft, active, v)
    }
    const g = draftToGeoJSON(draft, 'MULTIPOLYGON') as GeoJSON.MultiPolygon
    expect(g.coordinates).toHaveLength(2)
  })

  it('geometryToDraft round-trips a polygon with a hole', () => {
    const geometry: GeoJSON.Polygon = {
      type: 'Polygon',
      coordinates: [
        [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
        [[2, 2], [4, 2], [4, 4], [2, 2]]
      ]
    }
    const draft = geometryToDraft(geometry)
    expect(draft.parts[0].exterior.vertices).toHaveLength(4) // closing vertex dropped
    expect(draft.parts[0].holes[0].vertices).toHaveLength(3)
    expect(draftToGeoJSON(draft, 'POLYGON')).toEqual(geometry)
  })
})

describe('session predicates', () => {
  it('canComplete mirrors strict conversion', () => {
    expect(canComplete(session('POLYGON', draftWith(tri.slice(0, 2))))).toBe(false)
    expect(canComplete(session('POLYGON', draftWith(tri)))).toBe(true)
  })

  it('canStartNextPart only for MULTI types with a finishable part', () => {
    expect(canStartNextPart(session('POLYGON', draftWith(tri)))).toBe(false)
    expect(canStartNextPart(session('MULTIPOLYGON', draftWith(tri)))).toBe(true)
    expect(canStartNextPart(session('MULTILINESTRING', draftWith(tri.slice(0, 1))))).toBe(false)
  })

  it('canStartHole requires a closable exterior', () => {
    expect(canStartHole(session('POLYGON', draftWith(tri)))).toBe(true)
    expect(canStartHole(session('POLYGON', draftWith(tri.slice(0, 2))))).toBe(false)
    expect(canStartHole(session('LINESTRING', draftWith(tri)))).toBe(false)
  })
})

describe('computeMidpointHandles', () => {
  it('produces open-edge handles for lines and closing handles for rings', () => {
    const line = computeMidpointHandles(session('LINESTRING', draftWith(tri)))
    expect(line).toHaveLength(2)

    const poly = computeMidpointHandles(session('POLYGON', draftWith(tri)))
    expect(poly).toHaveLength(3)
    expect(poly[2]).toMatchObject({ lng: 2, lat: 2, insertAfterIdx: 2 })
  })

  it('covers holes with ring index ≥ 1', () => {
    const start = startHole(draftWith([[0, 0], [10, 0], [10, 10], [0, 10]]), 0)
    const active = start.active
    let draft = start.draft
    for (const v of [[2, 2], [4, 2], [4, 4]] as Position[]) draft = appendVertex(draft, active, v)
    const handles = computeMidpointHandles(session('POLYGON', draft, active))
    const holeHandles = handles.filter((h) => h.ring === 1)
    expect(holeHandles).toHaveLength(3)
  })
})

describe('allPaths', () => {
  it('enumerates exteriors and holes with refs', () => {
    const start = startHole(draftWith(tri), 0)
    const active = start.active
    let draft = start.draft
    draft = appendVertex(draft, active, [1, 1])
    const refs = allPaths(draft).map((p) => p.ref)
    expect(refs).toEqual([{ part: 0, ring: 0 }, { part: 0, ring: 1 }])
  })
})
