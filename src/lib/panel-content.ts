// Which panel holds what, when panels can come and go.
//
// The editor is the panel that owns a SET of things — its tabs — and each tab
// now records which editor it belongs to. That opens exactly one failure mode:
// content pointing at a panel that is not there. It arrives from three places,
// all of them real —
//
//   • a session.json or .ourgeoproj written when the workspace had two editors,
//     opened after the second was removed;
//   • a layout preset applied from Settings, which replaces the arrangement
//     wholesale and can drop a panel the current content is sitting in;
//   • an assistant calling `layout:reset`.
//
// — and its symptom is the worst kind: the tab still exists, still holds the
// user's work, and is drawn nowhere at all.
//
// So reconciliation is not a special case at each of those call sites. It runs
// after EVERY layout change, from the one place every change passes through
// (`useLayoutStore.apply`), and puts orphaned content back in the original
// panel. Cheap — the store returns early when nothing is orphaned.

import { panelInstanceIds } from './layout/instances'
import { ZONE_IDS, type LayoutState, type PanelId } from './layout/model'
import { useEditorStore, PRIMARY_EDITOR } from '@/store/editor'

/** Every panel the layout has a place for, open or not. */
export function placedPanelIds(layout: LayoutState): PanelId[] {
  return ZONE_IDS.flatMap((z) => layout.zones[z].order)
}

/** The editor panels this workspace has, in layout order. */
export function editorPanels(layout: LayoutState): PanelId[] {
  return panelInstanceIds(placedPanelIds(layout), PRIMARY_EDITOR)
}

/** Put any tab whose editor is gone back where it can be seen. */
export function reconcilePanelContent(layout: LayoutState): void {
  useEditorStore.getState().reclaimOrphanTabs(editorPanels(layout))
}
