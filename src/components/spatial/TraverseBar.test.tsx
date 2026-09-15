// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, configure } from '@testing-library/react'
import type { DraftGeometry, Position } from '@/lib/draw/types'

/**
 * What the entry strip shows, and what it refuses.
 *
 * The arithmetic is pinned in `curve-cogo.test.ts` and the geometry has been
 * driven through the real R session; what is left — and what a user actually
 * meets — is whether the right fields appear for the course they picked, and
 * whether the readout tells them what they just described. The element readout
 * is not decoration: checking a curve against a plat means checking L, C, T, E
 * and M, and a plat quotes those precisely so they can be checked.
 */

// The strip labels its controls for the assistant's highlight catalogue, and
// those labels are the stable handle here too — a class name is not.
configure({ testIdAttribute: 'data-ourgeo-id' })

const start: Position = [-122.4194, 37.7749]
const corner: Position = [-122.41889, 37.77531]

const draft: DraftGeometry = {
  parts: [{
    exterior: { vertices: [start, corner], segments: ['line'] },
    holes: [],
  }],
}

const session = {
  geometryType: 'LINESTRING',
  draft,
  activePath: { part: 0, ring: 0 },
  accessPath: 'plat',
  envName: '.GlobalEnv',
  appendRows: false,
}

const editState = {
  activeToolId: 'distance-bearing',
  addVertex: vi.fn(),
  pendingRowAdd: null,
  appendArcSegmentsToActivePath: vi.fn(),
  undoVertex: vi.fn(),
  retreatRow: vi.fn(),
}

vi.mock('@/store/geometryEdit', () => {
  const store = Object.assign(
    (sel: (s: unknown) => unknown) => sel(editState),
    { getState: () => editState }
  )
  return {
    useGeometryEditStore: store,
    selectActiveSession: () => session,
  }
})

vi.mock('@/hooks/useDrawActions', () => ({
  useDrawActions: () => ({ finish: vi.fn(), commitPoint: vi.fn(), undoLast: vi.fn() }),
}))
vi.mock('@/hooks/useAddFeature', () => ({
  useAddFeature: () => ({ confirmPendingRowAdd: vi.fn() }),
}))
vi.mock('@/lib/spatial-settings-persistence', () => ({ saveSpatialSettings: vi.fn() }))
// A geographic layer, so the strip stays on the geodesic basis and asks R for
// nothing — the grid path is R's and is verified against the real session.
vi.mock('@/lib/r-client', () => ({
  rClient: {
    spatialCrs: vi.fn(async () => ({
      success: true, input: 'EPSG:4326', epsg: 4326, name: 'WGS 84',
      isGeographic: true, unitName: null, unitToMetre: null,
    })),
    spatialTraverse: vi.fn(async () => ({ success: true, vertices: [], frame: null })),
  },
}))

import { TraverseBar } from './TraverseBar'
import { useTraverseStore } from '@/store/traverse'

const setCourse = (t: 'line' | 'tangent-curve' | 'curve'): void => {
  useTraverseStore.getState().setCourseType(t)
}

describe('TraverseBar', () => {
  beforeEach(() => {
    useTraverseStore.getState().reset()
    setCourse('line')
    useTraverseStore.getState().setUnit('ft')
    useTraverseStore.getState().setMode('quadrant')
    // `reset` deliberately keeps the element CHOICES — a plan that books its
    // curves by radius and arc length books all of them that way — so a test
    // that changes them has to put them back itself.
    useTraverseStore.getState().setCurve({ aId: 'radius', bId: 'delta' })
  })

  it('shows distance and bearing for a straight course', () => {
    render(<TraverseBar />)
    expect(screen.getByText('Distance')).toBeInTheDocument()
    expect(screen.getByText('Bearing')).toBeInTheDocument()
    expect(screen.queryByText('Turn')).not.toBeInTheDocument()
  })

  it('swaps to curve elements when the course changes', () => {
    render(<TraverseBar />)
    fireEvent.change(screen.getByTitle(/What kind of course/), { target: { value: 'tangent-curve' } })
    expect(screen.getByText('Turn')).toBeInTheDocument()
    expect(screen.queryByText('Distance')).not.toBeInTheDocument()
    // Radius and delta, because that is what the overwhelming majority of plats
    // quote — the other elements are a dropdown away.
    const selects = screen.getAllByRole('combobox')
    const values = selects.map((s) => (s as HTMLSelectElement).value)
    expect(values).toContain('radius')
    expect(values).toContain('delta')
  })

  /**
   * The deed call the whole feature was built for:
   * *"along a curve to the right having a radius of 250.00 feet, a central
   * angle of 45°30'00""* — and the plat's own redundant check figures come back.
   */
  it('prints every element of the curve the deed describes', () => {
    render(<TraverseBar />)
    fireEvent.change(screen.getByTitle(/What kind of course/), { target: { value: 'tangent-curve' } })
    fireEvent.change(screen.getByTestId('draw.traverse.curve.a'), { target: { value: '250' } })
    fireEvent.change(screen.getByTestId('draw.traverse.curve.b'), { target: { value: "45-30" } })

    // Arc length and chord are what a surveyor checks the page against.
    expect(screen.getByText('198.53 ft')).toBeInTheDocument()
    expect(screen.getByText('193.36 ft')).toBeInTheDocument()
    expect(screen.getByText("45°30'")).toBeInTheDocument()
    expect(screen.getByText('250.00 ft')).toBeInTheDocument()
  })

  it('refuses an ambiguous pair by name instead of guessing', () => {
    render(<TraverseBar />)
    fireEvent.change(screen.getByTitle(/What kind of course/), { target: { value: 'tangent-curve' } })
    fireEvent.change(screen.getByTestId('draw.traverse.curve.aId'), { target: { value: 'tangent' } })
    fireEvent.change(screen.getByTestId('draw.traverse.curve.bId'), { target: { value: 'midOrdinate' } })
    fireEvent.change(screen.getByTestId('draw.traverse.curve.a'), { target: { value: '230.9401' } })
    fireEvent.change(screen.getByTestId('draw.traverse.curve.b'), { target: { value: '53.5898' } })

    expect(screen.getByText(/more than one curve/i)).toBeInTheDocument()
  })

  /**
   * A tangent curve continues the course before it. With nothing to continue,
   * saying so and naming the way out beats drawing a curve pointing north.
   */
  it('says why a tangent curve cannot start a figure', () => {
    const only: DraftGeometry = { parts: [{ exterior: { vertices: [start], segments: [] }, holes: [] }] }
    session.draft = only
    render(<TraverseBar />)
    fireEvent.change(screen.getByTitle(/What kind of course/), { target: { value: 'tangent-curve' } })
    fireEvent.change(screen.getByTestId('draw.traverse.curve.a'), { target: { value: '250' } })
    fireEvent.change(screen.getByTestId('draw.traverse.curve.b'), { target: { value: '45' } })
    expect(screen.getByText(/continues the course before it/i)).toBeInTheDocument()
    session.draft = draft
  })

  it('asks a non-tangent curve which way it faces', () => {
    render(<TraverseBar />)
    fireEvent.change(screen.getByTitle(/What kind of course/), { target: { value: 'curve' } })
    const orient = screen.getByTestId('draw.traverse.curve.orientKind') as HTMLSelectElement
    expect(orient.value).toBe('chord')
    expect(Array.from(orient.options).map((o) => o.value)).toEqual(['chord', 'radial'])
    expect(screen.getByTestId('draw.traverse.curve.orient')).toBeInTheDocument()
  })

  it('offers degree of curve only where a 100-unit station means something', () => {
    render(<TraverseBar />)
    fireEvent.change(screen.getByTitle(/What kind of course/), { target: { value: 'tangent-curve' } })
    const inFeet = screen.getByTestId('draw.traverse.curve.aId') as HTMLSelectElement
    expect(Array.from(inFeet.options).map((o) => o.value)).toContain('degreeOfCurve')

    // The unit selector only shows on a straight course, so go back for it.
    fireEvent.change(screen.getByTitle(/What kind of course/), { target: { value: 'line' } })
    fireEvent.change(screen.getByTestId('draw.traverse.unit'), { target: { value: 'm' } })
    fireEvent.change(screen.getByTitle(/What kind of course/), { target: { value: 'tangent-curve' } })

    const inMetres = screen.getByTestId('draw.traverse.curve.aId') as HTMLSelectElement
    expect(Array.from(inMetres.options).map((o) => o.value)).not.toContain('degreeOfCurve')
  })
})
