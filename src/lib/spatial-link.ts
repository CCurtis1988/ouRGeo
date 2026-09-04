// Moving one object between the Environment panel, the data viewer and the map.
//
// The three panels show the same R objects from three angles, and until now
// each knew how to reach only the one next to it: the Environment panel could
// send an object to the map, and nothing could go back the other way. A user
// who opened a table, found the rows they wanted and then wanted to see them
// had to go and find the object in a third panel to get there.
//
// So the two directions live here, together, because they share one question —
// **is this object already on the map?** — and they have to answer it the same
// way, or the data viewer offers to add a layer that the Contents list is
// already showing.
//
// The matching rules are pure functions over plain data, so they are testable
// without a store, a map or an R session; the store-touching wrappers below
// are the thin part.

import { useEditorStore } from '@/store/editor'
import { useLayoutStore } from '@/store/layout'
import { useEnvironmentStore } from '@/store/environment'
import { useSpatialStore, type SpatialLayer } from '@/store/spatial'
import {
  useGeometryEditStore, selectPanelSession, PRIMARY_MAP,
} from '@/store/geometryEdit'
import { mapPanels } from '@/lib/panel-content'
import { layersOnPanel } from '@/lib/panel-layers'
import { chooseMapPanel } from '@/lib/map-target'
import type { PanelId } from '@/lib/layout/model'
import { layerExtentBbox } from '@/lib/layer-bbox'
import { isViewable } from '@/lib/validators'
import type { REnvironmentInfo } from '@/lib/r-client'
import {
  addSpatialLayer, addDbSpatialLayer,
  type AddedLayer, type DbSpatialRef, type SpatialObjectRef,
} from '@/lib/add-spatial-layer'

/** An R object as the environment names it: the variable, and where it lives. */
export interface ObjectRef {
  name: string
  envName: string
}

// ── Is it already on the map? ──────────────────────────────────────────────

/**
 * Whether a map layer is showing this object.
 *
 * The empty `envName` is the case worth knowing about: a database-backed layer
 * has no R environment (`addDbSpatialLayer`), so a strict comparison would say
 * that a .Rgeo dataset the user just sent to the map is not on the map, and
 * offer to add it again. An empty environment on either side therefore matches
 * on the name alone. That errs towards ASKING — the answer feeds a prompt, not
 * a refusal — which is the right way for it to be wrong.
 */
export function layerShowsObject(layer: Pick<SpatialLayer, 'name' | 'envName'>, ref: ObjectRef): boolean {
  if (layer.name !== ref.name) return false
  if (layer.envName === '' || ref.envName === '') return true
  return layer.envName === ref.envName
}

/**
 * The layers the Contents list is showing.
 *
 * Not simply every layer in the store: with a named map session active, the
 * ribbon lists only that session's layers, and "already open in the spatial
 * editor" has to mean what the user can see when they look. `null` layer ids
 * (no session yet) means every layer is on show.
 */
export function layersInView(layers: SpatialLayer[], sessionLayerIds: string[] | null): SpatialLayer[] {
  if (sessionLayerIds === null) return layers
  return layers.filter((l) => sessionLayerIds.includes(l.id))
}

export function layersForObject(layers: SpatialLayer[], ref: ObjectRef): SpatialLayer[] {
  return layers.filter((l) => layerShowsObject(l, ref))
}

/**
 * Layers currently on show that come from this object — on ANY map.
 *
 * "Already on the map" has to mean "anywhere the user can see it" once there
 * are two maps, or sending an object to the second one and then to the first
 * would never prompt, and the user would end up with the same layer twice
 * without ever being asked.
 */
export function mapLayersForObject(ref: ObjectRef): SpatialLayer[] {
  const geo = useGeometryEditStore.getState()
  const all = useSpatialStore.getState().layers
  const panels = mapPanels(useLayoutStore.getState().layout)
  const shown = new Map<string, SpatialLayer>()
  for (const p of panels.length > 0 ? panels : [PRIMARY_MAP]) {
    const session = selectPanelSession(geo, p)
    for (const l of layersOnPanel(all, geo.namedSessions, session?.layerIds ?? null)) {
      shown.set(l.id, l)
    }
  }
  return layersForObject([...shown.values()], ref)
}

/** The map drawing this layer: the one whose session owns it, else the
 *  focused one — an unowned layer is on all of them. */
export function panelShowingLayer(layerId: string): PanelId {
  const geo = useGeometryEditStore.getState()
  for (const p of mapPanels(useLayoutStore.getState().layout)) {
    if (selectPanelSession(geo, p)?.layerIds.includes(layerId)) return p
  }
  return geo.focusedSpatialPanel
}

// ── Map → data viewer ──────────────────────────────────────────────────────

/** Where a layer's attribute table lives, or why it has none. */
export type ViewerTarget =
  | { ok: true; name: string; envName: string; accessPath: string; objectClass: string }
  /** `short` labels a disabled menu item, where a sentence does not fit;
   *  `reason` is the whole explanation, for the console. */
  | { ok: false; short: string; reason: string }

interface EnvHit { envName: string; objectClass: string }

/** The object of that name, preferring the environment the layer came from. */
function findEnvObject(
  environments: REnvironmentInfo[], name: string, preferred: string | null,
): EnvHit | null {
  const order = preferred
    ? [...environments].sort((a, b) => Number(b.name === preferred) - Number(a.name === preferred))
    : environments
  for (const env of order) {
    const hit = env.objects.find((o) => o.name === name)
    if (hit) return { envName: env.name, objectClass: hit.class }
  }
  return null
}

/**
 * The data-viewer tab a layer should open, or the reason there isn't one.
 *
 * A raster is the honest refusal: it has pixels, not rows, and the value a user
 * wants from it is in the symbology editor's band statistics. Everything else
 * is a table, so the fallback when the environment listing has not caught up
 * (a layer added seconds ago, an object reached through an expression like
 * `lst$roads`) is to open it anyway rather than refuse something that works —
 * the data viewer reports a missing object itself, with a Retry.
 */
export function viewerTargetForLayer(layer: SpatialLayer, environments: REnvironmentInfo[]): ViewerTarget {
  if (layer.kind === 'raster') {
    return {
      ok: false,
      short: 'rasters have no attribute table',
      reason: `${layer.name} is a raster — it has bands, not an attribute table. `
        + 'Open its symbology for band statistics and a histogram.',
    }
  }

  const hit = findEnvObject(environments, layer.name, layer.envName || null)
  if (hit) {
    // `isViewable` also admits functions, which open in the function editor
    // rather than a table — and a map layer whose object is a function is a
    // layer pointing at the wrong thing, which is worth saying out loud.
    if (!isViewable(hit.objectClass) || hit.objectClass === 'function') {
      return {
        ok: false,
        short: `${hit.objectClass} has no table view`,
        reason: `${layer.name} is a ${hit.objectClass}, which the data viewer cannot show.`,
      }
    }
    return {
      ok: true, name: layer.name, envName: hit.envName,
      accessPath: layer.name, objectClass: hit.objectClass,
    }
  }

  if (layer.envName) {
    return {
      ok: true, name: layer.name, envName: layer.envName,
      accessPath: layer.name, objectClass: 'sf',
    }
  }

  return {
    ok: false,
    short: 'not in the R environment',
    reason: `${layer.name} is not in the R environment — its database connection may have been closed. `
      + 'Reconnect the .Rgeo file, or remove and re-add the layer.',
  }
}

/**
 * Open a layer's attribute table in the code editor.
 *
 * Opening the same object twice is already impossible: `addObjectTab`
 * deduplicates on access path + environment and activates the tab it finds, so
 * a second request selects the table the user already has rather than stacking
 * another copy of it beside it.
 */
export function openLayerInDataViewer(layer: SpatialLayer): { ok: true; tabId: string } | { ok: false; reason: string } {
  const target = viewerTargetForLayer(layer, useEnvironmentStore.getState().environments)
  if (!target.ok) return target
  const tabId = useEditorStore.getState().addObjectTab(
    target.name, target.envName, target.objectClass, target.accessPath, 'data-viewer',
  )
  // The editor is always open, but in a tabbed zone it can be the tab that
  // isn't showing — and a table that opened somewhere the user cannot see is
  // indistinguishable from a button that did nothing. `addObjectTab` put it in
  // the FOCUSED editor, so that is the one to bring forward.
  useLayoutStore.getState().setActivePanel(useEditorStore.getState().focusedEditor)
  return { ok: true, tabId }
}

/**
 * The database-backed send for an R variable, or null when it is an in-memory
 * object.
 *
 * A connected .Rgeo dataset is a lazy `dplyr::tbl`, so its geometry is not in
 * the session to be read as GeoJSON — the map gets it as tiles instead, and the
 * caller needs the whole proxy (table, key column, CRS) to ask for them. The
 * Environment panel has that on the item it is drawing; the data viewer has
 * only a variable name, and this is how it finds the rest.
 */
export function dbSpatialRefFor(
  environments: REnvironmentInfo[], name: string, envName: string,
): DbSpatialRef | null {
  const env = environments.find((e) => e.name === envName)
  const proxy = env?.objects.find((o) => o.name === name)?.rgeoProxy
  if (!proxy) return null
  if (proxy.kind !== 'sf' && proxy.kind !== 'geos') return null
  return {
    name,
    handle: proxy.handle,
    proxyName: proxy.name,
    geometryType: proxy.geometryType,
    geometryColumn: proxy.geometryColumn,
    pkColumn: proxy.pkColumn,
    crs: proxy.crs,
  }
}

// ── Data viewer / Environment → map ────────────────────────────────────────

/** Open the spatial editor, select the layer, and put it in view. */
export function focusMapLayer(layerId: string, panelId?: PanelId): void {
  const spatial = useSpatialStore.getState()
  const panel = panelId ?? panelShowingLayer(layerId)
  spatial.ensureOpen()
  // Opening a panel is not the same as showing it: in a tabbed zone the map
  // can open behind whatever tab is in front of it.
  useLayoutStore.getState().setActivePanel(panel)
  // The map that is about to move is also the one drawing tools should act on
  // — otherwise the user is looking at map 2 and drawing into map 1.
  useGeometryEditStore.getState().focusSpatialPanel(panel)
  spatial.setSelectedLayerId(layerId)
  const layer = spatial.layers.find((l) => l.id === layerId)
  const bbox = layer ? layerExtentBbox(layer) : null
  // A layer with no extent yet (database tiles still loading) falls back to
  // fitting everything, which at least moves the map to where the data is.
  // Aimed at ONE map: the other keeps whatever extent it was showing.
  if (bbox) spatial.fitMapToBbox(bbox, panel)
  else spatial.requestFitBounds(panel)
}

/**
 * Add an R spatial object to the map and take the user to it.
 *
 * Resolves to null when the workspace has two maps and the user dismissed the
 * question of which one — a cancel, not a failure, so callers report nothing.
 */
export async function sendObjectToMap(
  obj: SpatialObjectRef, panelId?: PanelId,
): Promise<AddedLayer | null> {
  const panel = panelId ?? await chooseMapPanel(obj.name)
  if (!panel) return null
  const added = await addSpatialLayer(obj, panel)
  focusMapLayer(added.layerId, panel)
  return added
}

/** Add a database-backed dataset to the map and take the user to it. */
export async function sendDbObjectToMap(
  ref: DbSpatialRef, panelId?: PanelId,
): Promise<AddedLayer | null> {
  const panel = panelId ?? await chooseMapPanel(ref.name)
  if (!panel) return null
  const added = await addDbSpatialLayer(ref, panel)
  focusMapLayer(added.layerId, panel)
  return added
}
