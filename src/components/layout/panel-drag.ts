import type React from 'react'
import { useLayoutStore } from '@/store/layout'
import type { PanelId, ZoneId } from '@/lib/layout/model'

// Moving a panel from one zone to another.
//
// Lifted out of `Zone.tsx` because the tab strip moved out too — a panel that
// draws its own zone's tabs (see `ZoneTabs`) carries this handler on those
// buttons, and importing it from `Zone.tsx` would have the zone and its tabs
// importing each other.

/**
 * Start moving a panel, on mouse events rather than HTML5 drag-and-drop.
 *
 * It WAS drag-and-drop: `draggable` on the grip, `onDrop` on the zones. The
 * drop logic was right and is unchanged — but the gesture never reached it.
 * Pressing the grip and dragging did nothing at all, which is the worst way for
 * a control to fail: the tooltip says "Move Environment", the cursor says grab,
 * and the panel sits where it is. The Contents list in the spatial editor has
 * always reordered layers on plain mouse events, in this same app, so that is
 * the pattern to follow rather than a second attempt at native dnd.
 *
 * The 4px threshold is what keeps a plain CLICK from entering drag mode — the
 * tab-strip buttons carry this handler as well as an onClick, and without it
 * every click on a tab would flash the drop targets across the whole window.
 *
 * **The drop is committed HERE, not in the zone that was dropped on**, and that
 * is not a stylistic choice. Each zone's overlay used to end the drag itself:
 * every one of them heard the mouseup, the one holding the slot moved the
 * panel, the rest cleared the drag. But React flushes a state update from a
 * discrete native event SYNCHRONOUSLY, so the first zone to hear the mouseup —
 * the left one, always, since effects register in tree order — cleared the drag
 * mid-dispatch, unmounted every overlay, and took the remaining listeners with
 * it. The zone actually under the cursor never ran. The gesture worked
 * perfectly when the mouseup was synthesized from a script, because that update
 * was merely batched; only a real one from a human hand failed.
 */
export function startPanelDrag(
  panel: PanelId, setDrag: (p: PanelId | null) => void,
): (e: React.MouseEvent) => void {
  return (e) => {
    if (e.button !== 0) return
    e.preventDefault()          // or the pointer selects text as it travels
    const x0 = e.clientX, y0 = e.clientY
    let started = false

    const onMove = (ev: MouseEvent): void => {
      if (started) return
      if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 4) return
      started = true
      setDrag(panel)
    }
    const onUp = (ev: MouseEvent): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      if (started) {
        const slot = slotUnder(ev.clientX, ev.clientY)
        if (slot) useLayoutStore.getState().movePanel(panel, slot.zone, slot.index)
      }
      setDrag(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
}

/** The insertion slot under the pointer, wherever it is. */
export function slotUnder(x: number, y: number): { zone: ZoneId; index: number } | null {
  const el = (document.elementFromPoint(x, y) as HTMLElement | null)
    ?.closest('[data-drop-zone]') as HTMLElement | null
  if (!el?.dataset.dropZone) return null
  return { zone: el.dataset.dropZone as ZoneId, index: Number(el.dataset.dropIndex) }
}
