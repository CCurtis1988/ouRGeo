import { create } from 'zustand'
import type { DrawContextMenuItem } from '@/lib/draw/types'

/**
 * Transient drawing-interaction state kept out of the geometryEdit store so
 * high-frequency mousemove updates (rubber band) only re-render the
 * DrawingLayer overlay, never MapView or the ribbon.
 */
interface DrawPreviewState {
  /** Cursor position while a draw-like tool is active — drives the rubber band. */
  cursor: [number, number] | null
  /** Ghost geometry preview (arc/rectangle/circle/offset previews in later phases). */
  ghost: GeoJSON.Geometry | null
  /** Right-click tool menu (screen coordinates relative to the viewport). */
  contextMenu: { x: number; y: number; items: DrawContextMenuItem[] } | null

  setCursor: (c: [number, number] | null) => void
  setGhost: (g: GeoJSON.Geometry | null) => void
  openContextMenu: (x: number, y: number, items: DrawContextMenuItem[]) => void
  closeContextMenu: () => void
  clear: () => void
}

export const useDrawPreviewStore = create<DrawPreviewState>((set) => ({
  cursor: null,
  ghost: null,
  contextMenu: null,

  setCursor: (cursor) => set({ cursor }),
  setGhost: (ghost) => set({ ghost }),
  openContextMenu: (x, y, items) => set({ contextMenu: { x, y, items } }),
  closeContextMenu: () => set({ contextMenu: null }),
  clear: () => set({ cursor: null, ghost: null, contextMenu: null })
}))
