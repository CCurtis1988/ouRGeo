// Dragging a tab, or a map session, from one panel to another.
//
// The same gesture as `startPanelDrag` in Zone.tsx, and written the same way
// for the same hard-won reasons:
//
//   • plain mouse events, not HTML5 drag-and-drop — the app's own drags
//     (the Contents list, the panel grips) all work this way, and a `draggable`
//     attribute inside Monaco's or MapLibre's subtree is not reliably honoured;
//   • a 4px threshold, so a plain CLICK on a tab still selects it rather than
//     flashing drop targets across the window;
//   • **the drop is committed here, in the one mouseup handler**, not by the
//     panel that was dropped on. Every mounted overlay hears the mouseup, and
//     React flushes a discrete native event's state update synchronously — so
//     the first overlay to clear the drag would unmount the rest mid-dispatch
//     and the panel under the cursor would never run.
//
// The commit is a callback rather than a store call so that a tab and a
// session — which move through completely different stores — share every part
// of this except the one line that differs.

import { useContentDragStore, type ContentKind } from '@/store/contentDrag'
import type { PanelId } from './layout/model'

/** The panel under the pointer that will take this kind of content, if any. */
export function dockUnder(x: number, y: number, kind: ContentKind): PanelId | null {
  const el = (document.elementFromPoint(x, y) as HTMLElement | null)
    ?.closest('[data-content-dock]') as HTMLElement | null
  if (!el?.dataset.contentDock || el.dataset.dockKind !== kind) return null
  return el.dataset.contentDock
}

export interface ContentDragOptions {
  kind: ContentKind
  id: string
  from: PanelId
  label: string
  /** Called once, with the panel the pointer was over. Same-panel drops are
   *  filtered out before this runs — moving a tab to where it already is is
   *  not a change, and reporting it as one would mark the layout dirty. */
  onDrop: (to: PanelId) => void
  /** Run on mousedown, before the threshold — a tab still selects itself when
   *  pressed, so the drag starts from the tab the user can see they grabbed. */
  onPress?: () => void
  /**
   * Run once the threshold is crossed and the drag is real.
   *
   * The session list needs this and cannot use `onPress`: closing the dropdown
   * on mousedown unmounts the row, so the click that was only ever meant to
   * SWITCH sessions never reaches its handler. Closing on drag-start keeps the
   * click working and still gets the dropdown out of the way before the
   * pointer has to aim at the map underneath it.
   */
  onStart?: () => void
}

export function startContentDrag(
  opts: ContentDragOptions,
): (e: React.MouseEvent) => void {
  return (e) => {
    if (e.button !== 0) return
    // Or the pointer selects the tab's label — and every other word it passes
    // over — as it travels. The click still fires: `preventDefault` on
    // mousedown suppresses the default text selection, not the click event.
    e.preventDefault()
    opts.onPress?.()
    const x0 = e.clientX, y0 = e.clientY
    let started = false
    const store = useContentDragStore.getState()

    const onMove = (ev: MouseEvent): void => {
      if (!started) {
        if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 4) return
        started = true
        opts.onStart?.()
        store.begin({
          kind: opts.kind, id: opts.id, from: opts.from, label: opts.label,
          x: ev.clientX, y: ev.clientY,
        })
        return
      }
      useContentDragStore.getState().moveTo(ev.clientX, ev.clientY)
    }
    const onUp = (ev: MouseEvent): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      if (started) {
        const to = dockUnder(ev.clientX, ev.clientY, opts.kind)
        if (to && to !== opts.from) opts.onDrop(to)
        useContentDragStore.getState().end()
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
}
