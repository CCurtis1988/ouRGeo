// Which panel holds what, when panels can come and go.
//
// The editor and the map are the two panels that own a SET of things — tabs
// and named map sessions — and both now record which panel each thing belongs
// to. That opens exactly one failure mode: content pointing at a panel that is
// not there. It arrives from three places, all of them real —
//
//   • a session.json or .ourgeoproj written when the workspace had two editors,
//     opened after the second was removed;
//   • a layout preset applied from Settings, which replaces the arrangement
//     wholesale and can drop a panel the current content is sitting in;
//   • an assistant calling `layout:reset`.
//
// — and its symptom is the worst kind: the tab or the session still exists,
// still holds the user's work, and is drawn nowhere at all.
//
// So reconciliation is not a special case at each of those call sites. It runs
// after EVERY layout change, from the one place every change passes through
// (`useLayoutStore.apply`), and puts orphaned content back in the original
// panel. Cheap — both stores return early when nothing is orphaned.

import { panelInstanceIds } from './layout/instances'
import { ZONE_IDS, type LayoutState, type PanelId } from './layout/model'
import { useEditorStore, PRIMARY_EDITOR } from '@/store/editor'
import { useGeometryEditStore, PRIMARY_MAP } from '@/store/geometryEdit'

/** Every panel the layout has a place for, open or not. */
export function placedPanelIds(layout: LayoutState): PanelId[] {
  return ZONE_IDS.flatMap((z) => layout.zones[z].order)
}

/** The editor panels this workspace has, in layout order. */
export function editorPanels(layout: LayoutState): PanelId[] {
  return panelInstanceIds(placedPanelIds(layout), PRIMARY_EDITOR)
}

/** The Spatial Editor panels this workspace has, in layout order. */
export function mapPanels(layout: LayoutState): PanelId[] {
  return panelInstanceIds(placedPanelIds(layout), PRIMARY_MAP)
}

/** Put any tab or map session whose panel is gone back where it can be seen. */
export function reconcilePanelContent(layout: LayoutState): void {
  useEditorStore.getState().reclaimOrphanTabs(editorPanels(layout))
  useGeometryEditStore.getState().reclaimOrphanSessions(mapPanels(layout))
}
