// Which layers a given map draws.
//
// With one Spatial Editor this question had a lazy answer — all of them — and
// the named-session `layerIds` only ever narrowed the Contents list. The map
// itself filtered by session solely while a drawing was in flight, so two
// sessions showed the same canvas and nobody noticed, because there was one
// canvas.
//
// With two maps that answer is unusable: both would draw everything, and a
// second map would be a copy of the first. So ownership becomes real, and the
// rule is stated once, here:
//
//   • a layer owned by a session is drawn on the map that session belongs to,
//     and nowhere else;
//   • a layer owned by NO session is drawn on every map.
//
// The second half is what keeps this from being a regression. Rasters have
// never joined a session (they are tiles, not editable features), and neither
// have layers added by the Data Connector's raster imports — under a plain
// "session layers only" rule every one of those would have vanished the moment
// a session existed. Unowned means shared, which is also the honest reading of
// "no session claims it".

import type { NamedSession } from '@/store/geometryEdit'
import type { SpatialLayer } from '@/store/spatial'

/**
 * @param mine  the layer ids of the session this map is showing, or null when
 *              it is showing none — in which case it draws the unowned ones.
 */
export function layersOnPanel(
  all: SpatialLayer[], sessions: Pick<NamedSession, 'layerIds'>[], mine: string[] | null,
): SpatialLayer[] {
  const owned = new Set<string>()
  for (const ns of sessions) for (const id of ns.layerIds) owned.add(id)
  const here = new Set(mine ?? [])
  return all.filter((l) => here.has(l.id) || !owned.has(l.id))
}
