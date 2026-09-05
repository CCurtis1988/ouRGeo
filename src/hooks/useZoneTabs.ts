import { useLayoutStore } from '@/store/layout'
import { openPanels, zoneOf, zoneHostsTabs, type PanelId, type ZoneId } from '@/lib/layout/model'
import { panelInfoList } from '@/lib/layout/panel-meta'

// Who draws a zone's tab strip — the zone, or the panels inside it.
//
// Separate from `ZoneTabs.tsx` so that file exports only its component: a
// module mixing components and plain functions loses Fast Refresh for both,
// which is the same reason `panel-meta.ts` sits beside `panels.tsx`.

/** Do the panels in this zone draw their own tabs? */
export function useZoneHostsTabs(zone: ZoneId | null): boolean {
  const layout = useLayoutStore((s) => s.layout)
  if (!zone) return false
  if (layout.zones[zone].mode !== 'tabs') return false
  return zoneHostsTabs(layout, zone, panelInfoList())
}

/**
 * Whether this panel should draw the zone tabs in its own header right now.
 *
 * False when the zone is split (each panel is visible and has its own header),
 * false when it is alone in its zone (a one-tab strip says nothing anyone
 * needs), and false for panels that did not opt in.
 */
export function usePanelDrawsTabs(panel: PanelId): boolean {
  const layout = useLayoutStore((s) => s.layout)
  const zone = zoneOf(layout, panel)
  const hosted = useZoneHostsTabs(zone)
  if (!zone || !hosted) return false
  return openPanels(layout, zone).length > 1
}
