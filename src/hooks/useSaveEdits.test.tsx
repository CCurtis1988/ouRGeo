// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePendingEditGroups } from './useSaveEdits'
import { useSpatialStore } from '@/store/spatial'
import type { PendingEditMeta } from '@/store/spatial'

const memMeta: PendingEditMeta = {
  source: 'memory',
  accessPath: 'pts',
  envName: '.GlobalEnv',
  columnName: 'geometry',
  colLib: 'sf'
}

beforeEach(() => {
  useSpatialStore.setState({ pendingGeometryEdits: {}, pendingEditMeta: {}, layers: [] })
})

describe('usePendingEditGroups', () => {
  it('returns a referentially stable snapshot when the store has not changed', () => {
    // Regression: deriving fresh group objects inside the zustand selector
    // made getSnapshot return a new reference every render, which React
    // escalates to "Maximum update depth exceeded" as soon as one staged
    // edit exists (e.g. the first click of a POINT drawing session).
    act(() => {
      useSpatialStore.getState().addPendingGeometryEdit(memMeta, {
        rowId: 0,
        kind: 'geometry',
        geometry: { type: 'Point', coordinates: [1, 2] }
      })
    })

    const { result, rerender } = renderHook(() => usePendingEditGroups())
    expect(result.current).toHaveLength(1)

    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })

  it('reflects store changes with fresh group summaries', () => {
    const { result } = renderHook(() => usePendingEditGroups())
    expect(result.current).toEqual([])

    act(() => {
      const s = useSpatialStore.getState()
      s.addPendingGeometryEdit(memMeta, { rowId: 0, kind: 'row-add', originalGeometry: null })
      s.addPendingGeometryEdit(memMeta, {
        rowId: 0,
        kind: 'geometry',
        geometry: { type: 'Point', coordinates: [1, 2] }
      })
    })

    expect(result.current).toHaveLength(1)
    expect(result.current[0]).toMatchObject({
      displayName: 'pts',
      geometryCount: 1,
      rowAddCount: 1
    })
  })
})
