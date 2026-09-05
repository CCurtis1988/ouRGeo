// A panel in mid-air between two zones.
//
// This was a `useState` in `EditorLayout`, passed down to every `Zone` as a
// prop pair — which was right for exactly as long as the only things that
// needed it were rendered by `EditorLayout` itself.
//
// The tab strip is now drawn by the PANELS (see `ZoneTabs`), so that a zone in
// tabs mode costs one header row rather than two. A panel is rendered deep
// inside `Zone` → `PanelSlot` → children, and threading a setter down through
// that to reach a tab button would be prop-drilling through two components
// that have no interest in it.
//
// So: the same move `store/contentDrag.ts` documents one level down, for the
// same reason — the two ends of the gesture are nowhere near each other in the
// tree. This holds only what has to be visible to a render; the gesture itself
// (the 4px threshold, the hit-testing, the single commit point) is still
// `startPanelDrag` in `Zone.tsx`.

import { create } from 'zustand'
import type { PanelId } from '@/lib/layout/model'

interface PanelDragState {
  /** The panel being dragged, or null. Drop targets light up on this. */
  panel: PanelId | null
  begin: (panel: PanelId) => void
  end: () => void
}

export const usePanelDragStore = create<PanelDragState>((set) => ({
  panel: null,
  begin: (panel) => set({ panel }),
  end: () => set({ panel: null }),
}))
