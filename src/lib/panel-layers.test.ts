import { describe, it, expect } from 'vitest'
import { layersOnPanel } from './panel-layers'
import type { SpatialLayer } from '@/store/spatial'

const layer = (id: string): SpatialLayer => ({ id } as SpatialLayer)

const roads = layer('l-roads')
const parks = layer('l-parks')
const dem = layer('l-dem')

const sessions = [
  { layerIds: ['l-roads'] },
  { layerIds: ['l-parks'] },
]

describe('which layers a map draws', () => {
  it('draws the layers of the session it is showing', () => {
    expect(layersOnPanel([roads, parks], sessions, ['l-roads'])).toEqual([roads])
  })

  it('does not draw another session’s layers', () => {
    // Without this two maps are copies of each other, which is the whole
    // reason for having a second one.
    expect(layersOnPanel([roads, parks], sessions, ['l-parks'])).toEqual([parks])
  })

  it('draws a layer no session claims, on every map', () => {
    // Rasters have never joined a session, and neither have the Data
    // Connector's raster imports. Under a plain "session layers only" rule
    // every one of them would vanish the moment a session existed.
    expect(layersOnPanel([roads, dem], sessions, ['l-roads'])).toEqual([roads, dem])
    expect(layersOnPanel([roads, dem], sessions, ['l-parks'])).toEqual([dem])
  })

  it('draws only the unowned ones when the map is showing no session', () => {
    expect(layersOnPanel([roads, parks, dem], sessions, null)).toEqual([dem])
  })

  it('draws everything when nothing is owned at all', () => {
    // A reloaded session: layers are restored from disk, named sessions are not.
    expect(layersOnPanel([roads, parks], [], null)).toEqual([roads, parks])
  })
})
