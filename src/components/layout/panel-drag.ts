import { usePanelDragStore } from '@/store/panelDrag'
import type React from 'react'
import { useLayoutStore } from '@/store/layout'
import type { PanelId, ZoneId } from '@/lib/layout/model'

// Moving a panel from one zone to another.
//
// Lifted out of `Zone.tsx` because the tab strip moved out too — a panel that
// draws its own zone's tabs (see `ZoneTabs`) carries this handler on those
// buttons, and importing it from `Zone.tsx` would have the zone and its tabs
// importing each other.

/** One gesture owns the drop. Committing from target overlays lets an earlier
 * mouseup listener unmount the real destination before it can handle the drop. */
export function startPanelDrag(
  panel: PanelId, setDrag: (p: PanelId | null) => void,
): (e: React.MouseEvent) => void {
  return (e) => {
    if (e.button !== 0) return
    e.preventDefault()          // or the pointer selects text as it travels
    const x0 = e.clientX, y0 = e.clientY
    let started = false

    const previousCursor = document.body.style.cursor
    const previousSelect = document.body.style.userSelect
    const cleanup = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onCancel)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousSelect
    }
    const onMove = (ev: MouseEvent): void => {
      if (started) return
      if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 4) return
      started = true
      document.body.style.cursor = 'grabbing'
      document.body.style.userSelect = 'none'
      setDrag(panel)
    }
    const onCancel = (): void => { cleanup(); setDrag(null) }
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') { event.preventDefault(); onCancel() } }
    const onUp = (ev: MouseEvent): void => {
      cleanup()
      if (started && useLayoutStore.getState().dragEnabled) {
        const element = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null
        const target = element?.closest<HTMLElement>('[data-drop-panel]')?.dataset.dropPanel
        if (target && target !== panel) usePanelDragStore.getState().offer({ panel, target, x: ev.clientX, y: ev.clientY, layout: useLayoutStore.getState().layout })
        else {
          const slot = slotUnder(ev.clientX, ev.clientY)
          if (slot) useLayoutStore.getState().movePanel(panel, slot.zone, slot.index)
        }
        // A completed drag must not also activate its original tab on click.
        const suppress = (event: MouseEvent): void => { event.preventDefault(); event.stopPropagation() }
        window.addEventListener('click', suppress, { capture: true, once: true })
        window.setTimeout(() => window.removeEventListener('click', suppress, true), 0)
      }
      setDrag(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', onCancel)
  }
}

/** The insertion slot under the pointer, wherever it is. */
export function slotUnder(x: number, y: number): { zone: ZoneId; index: number } | null {
  const el = (document.elementFromPoint(x, y) as HTMLElement | null)
    ?.closest('[data-drop-zone]') as HTMLElement | null
  if (!el?.dataset.dropZone) return null
  return { zone: el.dataset.dropZone as ZoneId, index: Number(el.dataset.dropIndex) }
}
