import React from 'react'
import { useSpatialSettingsStore, type MapTargetMode } from '@/store/spatialSettings'
import { saveSpatialSettings } from '@/lib/spatial-settings-persistence'
import { useLayoutStore } from '@/store/layout'
import { mapPanels } from '@/lib/panel-content'

/**
 * Where "send to the spatial editor" goes when the workspace has two maps.
 *
 * Shown only when there ARE two, because with one map the question has no
 * meaning and a setting that does nothing is worse than no setting. The
 * default is to ask: getting it wrong is invisible — the layer is added, the
 * console says so, and the map the user is looking at does not change.
 */
export function MapTargetPicker(): React.ReactElement | null {
  const mapTarget = useSpatialSettingsStore((s) => s.mapTarget)
  const setMapTarget = useSpatialSettingsStore((s) => s.setMapTarget)
  const mode = useSpatialSettingsStore((s) => s.initialExtentMode)
  const userExtent = useSpatialSettingsStore((s) => s.userExtent)
  const layout = useLayoutStore((s) => s.layout)
  const maps = mapPanels(layout)
  if (maps.length < 2) return null

  const choose = (next: MapTargetMode): void => {
    setMapTarget(next)
    void saveSpatialSettings(mode, userExtent)
  }

  return (
    <div className="flex flex-col gap-1.5">
      {/* The heading is inside the component, not beside it in SettingsDialog,
          so it disappears with the setting when there is only one map. */}
      <p className="text-[11px] font-medium uppercase tracking-wider text-geo-muted mb-2 mt-5">
        Sending an object to the map
      </p>
      {([
        ['ask', 'Ask which map', 'A short dialog names both maps and how many sessions each holds.'],
        ['last', 'Use the map I last worked in', 'No dialog. The object goes to whichever Spatial Editor was last clicked in.'],
      ] as const).map(([value, label, hint]) => (
        <label key={value} className="flex items-start gap-2 cursor-pointer">
          <input
            type="radio"
            name="ourgeo-map-target"
            className="accent-[#4493f8] mt-0.5"
            checked={mapTarget === value}
            onChange={() => choose(value)}
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-xs text-foreground">{label}</span>
            <span className="text-[10px] text-geo-muted">{hint}</span>
          </span>
        </label>
      ))}
    </div>
  )
}
