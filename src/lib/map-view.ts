// Where the map's view actually lives.
//
// It looks like `useSpatialStore.viewState`, and on a session with nothing on
// the map it is. But the Spatial Editor has **named sessions** — map
// workspaces, each owning a set of layers AND its own extent — and `MapView`
// renders from `sessionViewState ?? globalViewState`. Adding any layer at all
// creates a "Default" session (`add-spatial-layer.ts`), so from the first
// layer onwards the map is driven by the session's view and
// `useSpatialStore.viewState` is a mirror the map writes and never reads.
//
// That is what broke `map:setView`. Asked for a tour of Spain, the assistant
// put the landmarks on the map and then moved the mirror seven times: every
// call reported success, the console logged every one, and the map never
// moved. A write that lands somewhere nothing renders from is the worst kind
// of failure — there is nothing to see and nothing to read.
//
// So the precedence rule is written down once, here, and every writer uses it:
// `MapView`, reporting where the user has just panned to, and anything outside
// the map asking it to move.

import { useSpatialStore } from '@/store/spatial'
import { useGeometryEditStore, type ViewState } from '@/store/geometryEdit'
import type { PanelId } from '@/lib/layout/model'

/**
 * The view the map is showing right now — the one to read before nudging it.
 *
 * "The map" is the FOCUSED one once a workspace has two of them. Anything
 * asking this question from outside — `map:setView`, an export, the assistant —
 * means the map the user is working in, which is the same map its answer will
 * be applied to.
 */
export function mapView(panelId?: PanelId): ViewState {
  const geo = useGeometryEditStore.getState()
  const panel = panelId ?? geo.focusedSpatialPanel
  const active = geo.namedSessions.find((ns) => ns.id === geo.activeByPanel[panel])
  return active?.viewState ?? useSpatialStore.getState().viewState
}

/**
 * Move the map.
 *
 * Writes the active session's view when there is one, because that is what the
 * map renders from, and always mirrors it into the spatial store, which is
 * where the export codegen, the project bundle and the extent readouts look.
 * Both, every time: the session that owns the view today may be closed
 * tomorrow, and the two must not then disagree about where the user was.
 *
 * The map is a *controlled* component, so this is the whole gesture — the new
 * props reach MapLibre on the next render. It is not a request that the map
 * may or may not honour, and there is no animation to wait for.
 */
export function setMapView(view: ViewState, panelId?: PanelId): void {
  const edit = useGeometryEditStore.getState()
  const panel = panelId ?? edit.focusedSpatialPanel
  if (edit.activeByPanel[panel]) edit.setPanelViewState(panel, view)
  // The spatial store's `viewState` is one value and the export codegen, the
  // project bundle and the extent readouts all read it — so only the FOCUSED
  // map mirrors into it. A second map reporting where it happens to be pointed
  // would otherwise decide the extent of an export from the first.
  if (panel === edit.focusedSpatialPanel) useSpatialStore.getState().setViewState(view)
}
