import { panelTabGroup } from '@/lib/layout/dock-tree'
import React from 'react'
import { cn } from '@/lib/utils'
import { useLayoutStore } from '@/store/layout'
import { usePanelDragStore } from '@/store/panelDrag'
import { openPanels, zoneOf, type PanelId, type ZoneId } from '@/lib/layout/model'
import { panelInfo } from '@/lib/layout/panel-meta'
import { startPanelDrag } from './panel-drag'

// The tabs for one zone, drawn either by the zone or by a panel inside it.
//
// Lifted out of `Zone.tsx` so a panel can render it in its OWN header. The R
// console and the terminal each already have a header row; a zone strip above
// that meant two rows of chrome to reach one terminal, and the words "R
// console" on screen twice — once as a tab and once as a heading three pixels
// below it.
//
// Which of the two draws it is decided per zone, never per panel: see
// `zoneHostsTabs`.

interface Props {
  /** Omit to use the zone the `panel` is in. */
  zone?: ZoneId
  /** Set when a panel is drawing its own zone's tabs. */
  panel?: PanelId
  className?: string
  panels?: PanelId[]
  activePanel?: PanelId
}

export function ZoneTabs({ zone, panel, className, panels, activePanel }: Props): React.ReactElement | null {
  const layout = useLayoutStore((s) => s.layout)
  const setActivePanel = useLayoutStore((s) => s.setActivePanel)
  const dragEnabled = useLayoutStore((s) => s.dragEnabled)
  const beginDrag = usePanelDragStore((s) => s.begin)
  const endDrag = usePanelDragStore((s) => s.end)

  const z = zone ?? (panel ? zoneOf(layout, panel) : null)
  if (!z) return null
  const group = panel && layout.zones[z].tree ? panelTabGroup(layout.zones[z].tree!, panel) : null
  const ids = (panels ?? group?.panels ?? openPanels(layout, z)).filter(id => layout.open[id])
  if (ids.length === 0) return null
  const active = activePanel ?? group?.active ?? layout.zones[z].active ?? ids[0]

  const setDrag = (p: PanelId | null): void => { if (p) beginDrag(p); else endDrag() }

  return (
    <div
      className={cn('flex items-center gap-px flex-shrink-0', className)}
      data-ourgeo-id={`zone.tabs.${z}`}
      role="tablist"
      aria-label="Pane group"
    >
      {ids.map((id) => {
        const def = panelInfo(id)
        if (!def) return null
        return (
          <button
            key={id}
            role="tab"
            data-pane-tab={id}
            aria-selected={id === active}
            tabIndex={id === active ? 0 : -1}
            onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              const index = event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : (ids.indexOf(id) + (event.key === 'ArrowLeft' ? -1 : 1) + ids.length) % ids.length
              setActivePanel(ids[index])
              requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-pane-tab="${CSS.escape(ids[index])}"]`)?.focus())
            }}
            onMouseDown={dragEnabled ? startPanelDrag(id, setDrag) : undefined}
            onClick={() => setActivePanel(id)}
            className={cn(
              'px-2 h-6 text-[11px] whitespace-nowrap transition-colors border-b-2',
              id === active
                ? 'text-foreground border-geo-accent'
                : 'text-geo-muted border-transparent hover:text-foreground',
            )}
          >
            {def.label}
          </button>
        )
      })}
    </div>
  )
}
