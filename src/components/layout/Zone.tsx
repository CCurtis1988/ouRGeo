// One zone of the workspace, rendered from the layout model.
//
// This replaces three near-identical ~24-line IIFEs in EditorLayout that
// differed only in which component they mounted and which `useState` held
// their width. A zone knows its axis, so the same component lays panels out
// side by side on the right and stacked on the left; it knows its mode, so the
// same component renders a tab strip instead when asked.

import React from 'react'
import { GripVertical } from 'lucide-react'
import {
  openPanels, ZONE_LABELS, type LayoutState, type PanelId, type ZoneId,
} from '@/lib/layout/model'
import { panelRender } from '@/lib/layout/panels'
import { panelInfo, type PanelInfo } from '@/lib/layout/panel-meta'
import { useLayoutStore } from '@/store/layout'
import { startDragResize } from './resize'
import { cn } from '@/lib/utils'

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
function startPanelDrag(
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
function slotUnder(x: number, y: number): { zone: ZoneId; index: number } | null {
  const el = (document.elementFromPoint(x, y) as HTMLElement | null)
    ?.closest('[data-drop-zone]') as HTMLElement | null
  if (!el?.dataset.dropZone) return null
  return { zone: el.dataset.dropZone as ZoneId, index: Number(el.dataset.dropIndex) }
}

interface Props {
  zone: ZoneId
  layout: LayoutState
  drag: PanelId | null
  setDrag: (p: PanelId | null) => void
  /** Ceiling along the outer axis, in px — see EditorLayout, which computes it
   *  from the window so the centre always keeps a usable floor. */
  maxSize?: number
}

export function Zone({ zone, layout, drag, setDrag, maxSize }: Props): React.ReactElement | null {
  // Settings → Workspace can switch the grips off. The layout itself is
  // untouched by that: what it disables is the GESTURE, not rearranging, which
  // stays available from Settings and from the assistant.
  const dragEnabled = useLayoutStore((s) => s.dragEnabled)
  const state = layout.zones[zone]
  const ids = openPanels(layout, zone)
  if (ids.length === 0) return null

  const isRow = state.axis === 'row'
  const shown = state.mode === 'tabs'
    ? ids.filter((id) => id === (state.active ?? ids[0]))
    : ids

  return (
    <div
      className={cn(
        'relative flex min-w-0 min-h-0 overflow-hidden',
        state.mode === 'tabs' ? 'flex-col' : isRow ? 'flex-row' : 'flex-col',
        zone === 'center' ? 'flex-1' : 'flex-shrink-0',
      )}
      style={zone === 'center' ? undefined : sizeStyle(zone, state.size, maxSize)}
    >
      {state.mode === 'tabs' && (
        <TabStrip zone={zone} ids={ids} active={state.active ?? ids[0]} setDrag={setDrag} />
      )}

      {shown.map((id, i) => {
        const def = panelInfo(id)
        const render = def && panelRender(id)
        if (!def || !render) return null
        const prev = i > 0 ? shown[i - 1] : null
        return (
          <React.Fragment key={id}>
            {i > 0 && state.mode === 'split' && prev && (
              <InnerDivider zone={zone} before={prev} after={id} axis={isRow ? 'x' : 'y'} />
            )}
            <div
              className={cn(
                'relative group min-w-0 min-h-0 overflow-hidden',
                state.mode === 'tabs' && 'flex-1',
              )}
              style={state.mode === 'tabs' ? undefined : innerSize(isRow, state.weights[id], def.min)}
            >
              {state.mode === 'split' && dragEnabled && <PanelGrip def={def} setDrag={setDrag} />}
              {render()}
            </div>
          </React.Fragment>
        )
      })}

      {drag && <DropTargets zone={zone} ids={ids} isRow={isRow} />}
    </div>
  )
}

/**
 * A zone's size along its outer axis, capped so it cannot eat the window.
 *
 * The stored px size is the user's and is never rewritten — shrink the window
 * and grow it back and the zone is where it was. `maxSize` is a render-time
 * ceiling computed from the container, which is what the old layout did by
 * hand (`max = min(innerWidth * 2/3, innerWidth - 380)` on the map's divider):
 * without it, a stored 240px console on a 400px-tall window leaves about fifty
 * pixels to type in, and three open panels leave the editor none at all.
 */
function sizeStyle(zone: ZoneId, size: number, maxSize?: number): React.CSSProperties {
  const s = maxSize === undefined ? size : Math.min(size, maxSize)
  return zone === 'bottom' ? { height: s } : { width: s }
}

/**
 * A panel's share of its zone, as flexbox.
 *
 * `flex-basis: 0` is what makes the weights mean what they say: the panels
 * start from nothing and the whole zone is divided in proportion, so two equal
 * weights are exactly half each however tall the column is. Sized from a basis
 * of `auto` they would instead divide only the space their content did not
 * already claim.
 *
 * The minimum is the one thing still measured in pixels, and it belongs here
 * because this is where pixels exist — a share cannot know that 120px is the
 * least a panel header and one row of content need.
 */
function innerSize(isRow: boolean, weight: number, min: number): React.CSSProperties {
  return {
    flexGrow: weight,
    flexShrink: 1,
    flexBasis: 0,
    ...(isRow ? { minWidth: min } : { minHeight: min }),
  }
}

/** The handle that starts a move. Deliberately small and hover-revealed: it
 *  sits over a panel's own header, and a permanent bar on every panel would
 *  cost a row of vertical space nine times over for a gesture used rarely. */
function PanelGrip(
  { def, setDrag }: { def: PanelInfo; setDrag: (p: PanelId | null) => void },
): React.ReactElement {
  return (
    <div
      onMouseDown={startPanelDrag(def.id, setDrag)}
      title={`Move ${def.label} — drag into another zone`}
      data-ourgeo-id={`panel.grip.${def.id}`}
      className="absolute top-0 right-0 z-20 h-4 w-4 flex items-center justify-center
        cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100
        text-geo-muted hover:text-foreground transition-opacity"
    >
      <GripVertical className="w-3 h-3" />
    </div>
  )
}

function TabStrip(
  { zone, ids, active, setDrag }:
  { zone: ZoneId; ids: PanelId[]; active: PanelId; setDrag: (p: PanelId | null) => void },
): React.ReactElement {
  const setActivePanel = useLayoutStore((s) => s.setActivePanel)
  const dragEnabled = useLayoutStore((s) => s.dragEnabled)
  return (
    <div className="flex items-center gap-px h-6 flex-shrink-0 bg-geo-bg border-b border-geo-border overflow-x-auto"
      data-ourgeo-id={`zone.tabs.${zone}`}
    >
      {ids.map((id) => {
        const def = panelInfo(id)
        if (!def) return null
        return (
          <button
            key={id}
            onMouseDown={dragEnabled ? startPanelDrag(id, setDrag) : undefined}
            onClick={() => setActivePanel(id)}
            className={cn(
              'px-2 h-6 text-[11px] whitespace-nowrap transition-colors',
              id === active
                ? 'text-foreground bg-geo-panel border-b-2 border-geo-accent'
                : 'text-geo-muted hover:text-foreground',
            )}
          >
            {def.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Moves the boundary between the two panels either side of it, and nothing
 * else: the pair keeps its combined share, so a third panel in the zone does
 * not shuffle because two others were adjusted.
 *
 * The pixels come from the DOM, because that is the only place they exist —
 * the layout holds shares, and a share tells you nothing about how far the
 * pointer has to travel. The two panels are this divider's own DOM siblings
 * (they are rendered here, in this order), so no ref plumbing is needed to
 * find them.
 */
function InnerDivider(
  { zone, before, after, axis }:
  { zone: ZoneId; before: PanelId; after: PanelId; axis: 'x' | 'y' },
): React.ReactElement {
  const splitPanels = useLayoutStore((s) => s.splitPanels)
  const minBefore = panelInfo(before)?.min ?? 100
  const minAfter = panelInfo(after)?.min ?? 100

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>): void => {
    const a = e.currentTarget.previousElementSibling as HTMLElement | null
    const b = e.currentTarget.nextElementSibling as HTMLElement | null
    if (!a || !b) return
    const extent = (el: HTMLElement): number => {
      const box = el.getBoundingClientRect()
      return axis === 'x' ? box.width : box.height
    }
    const from = extent(a)
    const pair = from + extent(b)
    // Both minimums already exceed the space the two of them have. Dragging
    // would only fight the clamp, so leave the boundary where it is.
    if (pair <= minBefore + minAfter) return
    startDragResize({
      axis,
      from,
      direction: 1,
      min: minBefore,
      max: pair - minAfter,
      onResize: (px) => splitPanels(before, after, px / pair),
    })(e)
  }

  return (
    <div
      className={cn(
        'bg-geo-border hover:bg-geo-accent flex-shrink-0 transition-colors',
        axis === 'x' ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize',
      )}
      title={`Drag to resize — double-click to share ${ZONE_LABELS[zone].toLowerCase()} evenly`}
      onMouseDown={onMouseDown}
      onDoubleClick={() => useLayoutStore.getState().evenPanels(zone)}
    />
  )
}

/**
 * A zone with nothing in it, offered as a drop target while a panel is moving.
 *
 * An empty zone renders as nothing at all, which is right until you have just
 * dragged the last panel out of one: the left column then has no pixels, so
 * there is nowhere to aim, and a panel can be moved out of a zone but never
 * back into it. This strip exists only during a drag and only for a zone that
 * is empty, so it costs nothing the rest of the time.
 *
 * The highlight is plain CSS `:hover` — the pointer is genuinely over this
 * element (there is no native drag in flight to suppress it), so no JS needs to
 * track it.
 */
export function EmptyZoneTarget({ zone }: { zone: ZoneId }): React.ReactElement {
  const vertical = zone === 'left' || zone === 'right'
  return (
    <div
      data-drop-zone={zone}
      data-drop-index={0}
      title={`Drop here to move the panel to the ${ZONE_LABELS[zone].toLowerCase()}`}
      className={cn(
        'flex-shrink-0 z-30 border-dashed border-geo-accent/40 bg-geo-accent/5',
        'hover:bg-geo-accent/25 transition-colors cursor-grabbing',
        vertical ? 'w-8 border-x' : 'h-8 border-y',
      )}
    />
  )
}

/**
 * While a panel is being dragged, every zone shows insertion slots — and does
 * nothing else. The slots are hit-tested by `startPanelDrag`, from their
 * `data-drop-zone` attributes; all this tracks is which one to light up.
 *
 * An overlay rather than handlers on the panels themselves: a panel's own
 * content (the map, Monaco) swallows pointer events and would never see the
 * drop. The overlay only exists during a drag, so nothing intercepts a click
 * the rest of the time.
 *
 * Each zone hit-tests for itself, from the window's mousemove — which is why
 * no shared "where is the pointer" state is needed anywhere. Every mounted
 * overlay sees the mouseup; only the one holding the slot under the cursor
 * moves anything.
 */
function DropTargets(
  { zone, ids, isRow }: { zone: ZoneId; ids: PanelId[]; isRow: boolean },
): React.ReactElement {
  const [over, setOver] = React.useState<number | null>(null)
  const slots = ids.length + 1

  React.useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      const slot = slotUnder(e.clientX, e.clientY)
      setOver(slot && slot.zone === zone ? slot.index : null)
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [zone])

  return (
    <div
      className={cn(
        'absolute inset-0 z-30 flex cursor-grabbing',
        // The zone lights up as a whole, because the thing being chosen is
        // WHICH ZONE — the slot within it is the fine adjustment, and with
        // only a hairline to look for the gesture read as doing nothing.
        'ring-1 ring-inset ring-geo-accent/30 bg-geo-accent/5',
        isRow ? 'flex-row' : 'flex-col',
      )}
    >
      {Array.from({ length: slots }, (_, i) => (
        <div
          key={i}
          data-drop-zone={zone}
          data-drop-index={i}
          className="flex-1 flex items-center justify-center"
        >
          <div
            className={cn(
              'transition-colors rounded-full',
              isRow ? 'w-1 h-full' : 'h-1 w-full',
              over === i ? 'bg-geo-accent' : 'bg-geo-accent/0',
            )}
          />
        </div>
      ))}
    </div>
  )
}
