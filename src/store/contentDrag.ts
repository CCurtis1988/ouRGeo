// A tab or a map session in mid-air between two panels.
//
// Lifted into a store rather than held in the component that started it,
// because the two ends of the gesture are nowhere near each other in the tree:
// a tab strip lives deep inside `CodeEditor`, and the panel it is being
// dropped on is a sibling of that panel's whole subtree. `Zone` renders the
// drop targets, and it has no other way to learn that a drag is happening.
//
// The drag itself — the mouse handlers, the threshold and the commit — is in
// `lib/content-drag.ts`. This holds only what has to be visible to the render.

import { create } from 'zustand'
import type { PanelId } from '@/lib/layout/model'

/** What is being dragged, which decides which panels can accept it. */
export type ContentKind = 'tab' | 'session'

export interface ContentDrag {
  kind: ContentKind
  /** Tab id, or named-session id. */
  id: string
  /** The panel it started in — the one drop target that is a no-op. */
  from: PanelId
  /** What to write on the label that follows the pointer. */
  label: string
  /** Where the pointer is, for that label. */
  x: number
  y: number
}

interface ContentDragState {
  drag: ContentDrag | null
  begin: (d: ContentDrag) => void
  moveTo: (x: number, y: number) => void
  end: () => void
}

export const useContentDragStore = create<ContentDragState>((set) => ({
  drag: null,
  begin: (drag) => set({ drag }),
  moveTo: (x, y) => set((s) => (s.drag ? { drag: { ...s.drag, x, y } } : s)),
  end: () => set({ drag: null }),
}))
