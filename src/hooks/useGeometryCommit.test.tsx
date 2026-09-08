// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGeometryCommit } from './useGeometryCommit'
import { useGeometryEditStore, selectActiveSession } from '@/store/geometryEdit'
import { useSpatialStore, pendingGroupKey } from '@/store/spatial'
import type { PendingEditMeta } from '@/store/spatial'

const meta: PendingEditMeta = {
  source: 'memory', accessPath: 'pts', envName: '.GlobalEnv',
  columnName: 'geometry', colLib: 'sf'
}
const key = pendingGroupKey(meta)

const staged = (): { rowId: number }[] =>
  (useSpatialStore.getState().pendingGeometryEdits[key] ?? [])
    .filter((e) => (e.kind ?? 'geometry') === 'geometry')

beforeEach(() => {
  useSpatialStore.setState({ pendingGeometryEdits: {}, pendingEditMeta: {}, layers: [] })
  useGeometryEditStore.setState({
    namedSessions: [], activeSessionId: null, isEditMode: false,
    activeToolId: null, pendingRowAdd: false, commitLog: []
  })
  act(() => {
    useGeometryEditStore.getState().startEditing({
      ...meta, geometryType: 'POINT', currentRow: 0, totalRows: 3, originalGeometry: null
    })
  })
})

describe('which row a commit lands in', () => {
  it('is the row the session is on NOW, not the one it was on when the callback was built', () => {
    // Distance & Bearing answers the "add another row?" prompt and places its
    // leg in the same keystroke, so the session moves between the render that
    // produced this callback and the call itself. Closing over `session` put
    // the point in the row BEFORE the one just appended — silently
    // overwriting the previous point, which is data loss with nothing on
    // screen to say so.
    const { result } = renderHook(() => useGeometryCommit())
    const commit = result.current.commitAndAdvance

    // Move the session on without letting React hand out a fresh callback.
    useGeometryEditStore.getState().advanceRow(null)
    expect(selectActiveSession(useGeometryEditStore.getState())!.currentRow).toBe(1)

    void commit({ type: 'Point', coordinates: [1, 2] })
    expect(staged().map((e) => e.rowId)).toEqual([1])
  })

  it('advances the row, and asks to add one when the dataset runs out', async () => {
    const { result } = renderHook(() => useGeometryCommit())
    const commit = result.current.commitAndAdvance
    const row = (): number => selectActiveSession(useGeometryEditStore.getState())!.currentRow

    await act(async () => { await commit({ type: 'Point', coordinates: [1, 2] }) })
    expect(row()).toBe(1)
    await act(async () => { await commit({ type: 'Point', coordinates: [2, 3] }) })
    expect(row()).toBe(2)
    await act(async () => { await commit({ type: 'Point', coordinates: [3, 4] }) })
    // The last row is written and the session stays on it — the ribbon is now
    // asking whether to add another, which is what `retreatRow` undoes.
    expect(row()).toBe(2)
    expect(useGeometryEditStore.getState().pendingRowAdd).toBe(true)
    expect(staged().map((e) => e.rowId)).toEqual([0, 1, 2])
  })
})
