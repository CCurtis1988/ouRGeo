import { describe, it, expect, beforeEach, vi } from 'vitest'
import { actionById } from './registry'
import { validateArgs, type Args } from './types'
import { useSpatialStore, type SpatialLayer } from '@/store/spatial'
import { useSessionStore } from '@/store/session'
import { inverse } from '@/lib/draw/cogo'
import type { Position } from '@/lib/draw/types'

vi.mock('@/lib/r-client', () => ({
  rClient: { execute: vi.fn(async () => ({ success: true, output: 'ok' })) },
}))

/**
 * Run the action the way `run_ui_action` does — **validation first**.
 *
 * The order is the point (see `theme-actions.test.ts`): a handler that works
 * perfectly is unreachable if the parameter list refuses the call, and calling
 * `action.run` directly in a test hides exactly that.
 */
const run = async (id: string, args: Args = {}): Promise<string> => {
  const action = actionById(id)
  if (!action) throw new Error(`no action ${id}`)
  const invalid = validateArgs(action, args)
  if (invalid) return `FAILED: ${invalid}`
  const res = await action.run(args)
  return `${res.ok ? '' : 'FAILED: '}${res.message}`
}

const layer = (over: Partial<SpatialLayer> = {}): SpatialLayer => ({
  id: 'l1', name: 'bounds', envName: '.GlobalEnv', geometryType: 'LINESTRING',
  geojson: { type: 'FeatureCollection', features: [] },
  visible: true, color: '#4493f8', opacity: 1, colLib: 'sf', columnName: 'geometry',
  ...over,
})

const staged = (): GeoJSON.Geometry | null => {
  const edits = Object.values(useSpatialStore.getState().pendingGeometryEdits)[0] ?? []
  return edits.find((e) => e.kind === 'geometry')?.geometry ?? null
}

beforeEach(() => {
  useSpatialStore.setState({
    layers: [layer()], selectedLayerId: null, isOpen: true,
    pendingGeometryEdits: {}, pendingEditMeta: {},
  })
  useSessionStore.setState({ consoleHistory: [] })
})

describe('draw:traverse', () => {
  it('walks the legs geodesically from the start point', async () => {
    const msg = await run('draw:traverse', {
      layer: 'bounds',
      start: [-122.4194, 37.7749],
      legs: [{ distance: 150, bearing: 45 }, { distance: 100, bearing: '135' }],
    })
    expect(msg).toContain('2 legs')
    const g = staged() as GeoJSON.LineString
    expect(g.type).toBe('LineString')
    expect(g.coordinates).toHaveLength(3)
    // Each leg is the length and direction it was given, measured back.
    const first = inverse(g.coordinates[0] as Position, g.coordinates[1] as Position)
    // Walking a leg and measuring it back agrees to a couple of micrometres
    // and a milliarcsecond — Vincenty's series truncation over a short line,
    // and orders of magnitude below anything a coordinate prints.
    expect(first.distanceM).toBeCloseTo(150, 4)
    expect(first.initialAzimuth).toBeCloseTo(45, 6)
  })

  it('reads every notation the strip reads', async () => {
    await run('draw:traverse', {
      layer: 'bounds',
      start: [0, 0],
      legs: [{ distance: '100', bearing: "N45°30'E" }, { distance: '328.08ft', bearing: 'R90' }],
    })
    const g = staged() as GeoJSON.LineString
    const second = inverse(g.coordinates[1] as Position, g.coordinates[2] as Position)
    // 328.08 international feet is 100 m, and R90 turns 90° right of the
    // azimuth the first leg ARRIVED on.
    expect(second.distanceM).toBeCloseTo(100, 1)
    expect(second.initialAzimuth).toBeCloseTo(135.5, 2)
  })

  it('closes a ring when asked, and builds a polygon on a polygon layer', async () => {
    useSpatialStore.setState({ layers: [layer({ geometryType: 'POLYGON' })] })
    const msg = await run('draw:traverse', {
      layer: 'bounds', start: [0, 0], close: true,
      legs: [
        { distance: 100, bearing: 0 }, { distance: 100, bearing: 90 },
        { distance: 100, bearing: 180 },
      ],
    })
    expect(msg).toContain('Polygon')
    const g = staged() as GeoJSON.Polygon
    expect(g.type).toBe('Polygon')
    expect(g.coordinates[0][0]).toEqual(g.coordinates[0][g.coordinates[0].length - 1])
  })

  it('refuses a polygon that was never closed, and says how to close it', async () => {
    useSpatialStore.setState({ layers: [layer({ geometryType: 'POLYGON' })] })
    const msg = await run('draw:traverse', {
      layer: 'bounds', start: [0, 0],
      legs: [{ distance: 100, bearing: 0 }, { distance: 100, bearing: 90 }],
    })
    expect(msg).toContain('close: true')
  })

  it('names the leg a bad bearing is in', async () => {
    const msg = await run('draw:traverse', {
      layer: 'bounds', start: [0, 0],
      legs: [{ distance: 100, bearing: 45 }, { distance: 100, bearing: 'sideways' }],
    })
    expect(msg).toContain('Leg 2')
  })

  it('refuses a deflection with no leg to turn from, at the boundary', async () => {
    const msg = await run('draw:traverse', {
      layer: 'bounds', start: [0, 0], notation: 'deflection',
      legs: [{ distance: 100, bearing: 'R90' }],
    })
    expect(msg).toContain('Leg 1')
    expect(msg).toContain('azimuth or a quadrant bearing')
  })

  it('is refused by validateArgs before it can run, on a unit that does not exist', async () => {
    const msg = await run('draw:traverse', {
      layer: 'bounds', start: [0, 0], unit: 'furlongs',
      legs: [{ distance: 100, bearing: 45 }],
    })
    expect(msg).toMatch(/FAILED: .*unit/i)
    expect(staged()).toBeNull()
  })

  it('echoes the R that reproduces it, like a hand-typed traverse', async () => {
    await run('draw:traverse', {
      layer: 'bounds', start: [-122.4194, 37.7749],
      legs: [{ distance: 150, bearing: 45 }],
    })
    const echoed = useSessionStore.getState().consoleHistory
      .filter((e) => e.type === 'info').map((e) => e.text).join('\n')
    expect(echoed).toContain('ourgeo_traverse(')
    expect(echoed).toContain('distance = c(150)')
  })

  it('stages rather than writes, and says so', async () => {
    const msg = await run('draw:traverse', {
      layer: 'bounds', start: [0, 0], legs: [{ distance: 10, bearing: 0 }],
    })
    expect(msg).toContain('not yet written to the R object')
  })
})
