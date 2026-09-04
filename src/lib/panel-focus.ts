// Which editor a new tab opens in, and which map a drawing tool draws on.
//
// Both questions have the same answer — the panel the user last clicked in —
// and it has to be one answer, set in one place, or the two drift: an editor
// that thinks it has focus while the layout thinks another one does produces a
// new tab appearing in the panel the user is not looking at, with nothing on
// screen to explain it.
//
// Called from `Zone`, on mousedown CAPTURE, so it runs before whatever the
// click was actually for. A click that starts a drawing must have moved focus
// before the first vertex lands, or the vertex goes to the other map.

import { basePanelId } from './layout/instances'
import type { PanelId } from './layout/model'
import { useLayoutStore } from '@/store/layout'
import { useEditorStore, PRIMARY_EDITOR } from '@/store/editor'
import { useGeometryEditStore, PRIMARY_MAP } from '@/store/geometryEdit'

export function focusPanel(id: PanelId): void {
  useLayoutStore.getState().focusPanel(id)
  const base = basePanelId(id)
  if (base === PRIMARY_EDITOR) useEditorStore.getState().focusEditor(id)
  else if (base === PRIMARY_MAP) useGeometryEditStore.getState().focusSpatialPanel(id)
}
