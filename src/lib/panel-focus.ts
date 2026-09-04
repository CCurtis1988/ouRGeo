// Which editor a new tab opens in.
//
// The answer is the panel the user last clicked in, and it has to be one
// answer set in one place, or the two drift: an editor that thinks it has
// focus while the layout thinks another one does produces a new tab appearing
// in the panel the user is not looking at, with nothing on screen to explain
// it.
//
// Called from `Zone`, on mousedown CAPTURE, so it runs before whatever the
// click was actually for.

import { basePanelId } from './layout/instances'
import type { PanelId } from './layout/model'
import { useLayoutStore } from '@/store/layout'
import { useEditorStore, PRIMARY_EDITOR } from '@/store/editor'

export function focusPanel(id: PanelId): void {
  useLayoutStore.getState().focusPanel(id)
  if (basePanelId(id) === PRIMARY_EDITOR) useEditorStore.getState().focusEditor(id)
}
