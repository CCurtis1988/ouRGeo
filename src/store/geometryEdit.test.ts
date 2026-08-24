import { describe, it, expect, beforeEach } from 'vitest'
import { useGeometryEditStore, selectActiveSession } from './geometryEdit'
import { draftIsEmpty } from '@/lib/draw/draft'

function startPointSession(totalRows = 1) {
  useGeometryEditStore.getState().startEditing({
    accessPath: 'pts',
    envName: '.GlobalEnv',
    columnName: 'geometry',
    colLib: 'sf',
    geometryType: 'POINT',
    currentRow: 0,
    totalRows,
    originalGeometry: null
  })
}

beforeEach(() => {
  useGeometryEditStore.setState({
    namedSessions: [],
    activeSessionId: null,
    isEditMode: false,
    activeToolId: null,
    pendingRowAdd: false,
    commitLog: []
  })
})

describe('requestRowAdd', () => {
  it('clears the committed draft so stray clicks cannot keep mutating it', () => {
    // Regression: after a POINT click committed (and the "add another?"
    // prompt appeared), the draft kept its vertex and further clicks piled
    // more vertices on — rendering extra markers while only the first
    // vertex was ever saved.
    startPointSession()
    const store = useGeometryEditStore.getState()
    store.addVertex(10, 20)
    expect(draftIsEmpty(selectActiveSession(useGeometryEditStore.getState())!.draft)).toBe(false)

    store.requestRowAdd()
    const session = selectActiveSession(useGeometryEditStore.getState())!
    expect(useGeometryEditStore.getState().pendingRowAdd).toBe(true)
    expect(draftIsEmpty(session.draft)).toBe(true)
    expect(session.undoStack).toHaveLength(0)
    expect(session.redoStack).toHaveLength(0)
  })

  it('resolveRowAdd(true) advances to the fresh row with an empty draft', () => {
    startPointSession()
    const store = useGeometryEditStore.getState()
    store.addVertex(10, 20)
    store.requestRowAdd()
    store.resolveRowAdd(true, 2)

    const session = selectActiveSession(useGeometryEditStore.getState())!
    expect(useGeometryEditStore.getState().pendingRowAdd).toBe(false)
    expect(session.currentRow).toBe(1)
    expect(session.totalRows).toBe(2)
    expect(draftIsEmpty(session.draft)).toBe(true)
  })
})
