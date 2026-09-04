// Which Spatial Editor a sent object lands on.
//
// With one map this never needed asking. With two, getting it wrong is
// invisible: the layer is added, the call reports success, the console logs
// it, and the map the user is looking at does not change — which is
// indistinguishable from the button having done nothing. That is why the
// default is to ask rather than to guess.
//
// `last` (Settings → Spatial Editor) is for anyone who has settled into using
// one of the two maps: the last map they worked in, with no dialog. It is a
// preference and not the default precisely because "the last map I used" is a
// fact about the past that a user has to remember to be able to predict.

import { useLayoutStore } from '@/store/layout'
import { useGeometryEditStore, PRIMARY_MAP } from '@/store/geometryEdit'
import { useSpatialSettingsStore } from '@/store/spatialSettings'
import { useMapTargetStore } from '@/store/mapTarget'
import { mapPanels } from './panel-content'
import type { PanelId } from './layout/model'

/**
 * Resolve the map to send `what` to, asking the user when that is the setting.
 *
 * Returns null only when the user cancelled — callers must treat that as "do
 * nothing", not as an error.
 */
export async function chooseMapPanel(what: string): Promise<PanelId | null> {
  const panels = mapPanels(useLayoutStore.getState().layout)
  // One map (or, mid-reload, none yet): there is nothing to ask about.
  if (panels.length <= 1) return panels[0] ?? PRIMARY_MAP

  if (useSpatialSettingsStore.getState().mapTarget === 'last') {
    const last = useGeometryEditStore.getState().focusedSpatialPanel
    return panels.includes(last) ? last : panels[0]
  }
  return useMapTargetStore.getState().ask(what, panels)
}
